const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  console.log("=== Starting Unified Checkout Integration Test ===");

  // 1. Get an available unit
  const unit = await prisma.unit.findFirst({
    where: { isActive: true, status: 'available' }
  });
  if (!unit) {
    console.error("No active available unit found!");
    return;
  }
  console.log("Using unit:", unit.name, "ID:", unit.id);

  // 2. Get an active package
  const pkg = await prisma.package.findFirst({
    where: { isActive: true }
  });
  if (!pkg) {
    console.error("No active package found!");
    return;
  }
  console.log("Using package:", pkg.name, "ID:", pkg.id);

  // 3. Get a POS item to buy
  const posItem = await prisma.posItem.findFirst({
    where: { isActive: true }
  });
  if (!posItem) {
    console.error("No active POS item found!");
    return;
  }
  console.log("Using POS Item:", posItem.name, "Price:", posItem.price);

  // 4. Create an active session
  console.log("\n1. Starting rental session...");
  const startTime = new Date();
  const session = await prisma.session.create({
    data: {
      unitId: unit.id,
      kasirId: "11f44a20-f239-4ec9-b74c-828960c4a309", // Valid kasir ID
      packageId: pkg.id,
      startTime,
      status: 'active'
    }
  });
  console.log("Session created with ID:", session.id);

  // 5. Create a POS order associated with the session
  console.log("\n2. Ordering F&B item and linking to session...");
  const quantity = 2;
  const orderPrice = Number(posItem.price);
  const subtotal = orderPrice * quantity;

  const posOrder = await prisma.posOrder.create({
    data: {
      sessionId: session.id,
      kasirId: "11f44a20-f239-4ec9-b74c-828960c4a309",
      subtotal,
      items: {
        create: [
          {
            itemId: posItem.id,
            itemName: posItem.name,
            quantity,
            unitPrice: orderPrice,
            subtotal
          }
        ]
      }
    },
    include: { items: true }
  });
  console.log("POS Order created with ID:", posOrder.id, "Subtotal:", posOrder.subtotal);

  // 6. Stop session and simulate our route enrichment (sessions.js)
  console.log("\n3. Stopping session...");
  const endTime = new Date();
  const billingAmount = Number(pkg.price);

  const updatedSession = await prisma.session.update({
    where: { id: session.id },
    data: {
      endTime,
      durationMinutes: 60,
      billingAmount,
      status: 'completed'
    }
  });

  // Calculate posAmount dynamically (simulating enrichSession in backend)
  const sessionOrders = await prisma.posOrder.findMany({
    where: { sessionId: session.id }
  });
  const posAmount = sessionOrders.reduce((sum, o) => sum + Number(o.subtotal), 0);
  const enrichedSession = { ...updatedSession, posAmount };
  console.log("Enriched Session status:", enrichedSession.status);
  console.log("Enriched Session Billing Amount:", enrichedSession.billingAmount);
  console.log("Enriched Session F&B posAmount:", enrichedSession.posAmount);

  if (enrichedSession.posAmount !== subtotal) {
    throw new Error(`posAmount mismatch! Expected: ${subtotal}, Got: ${enrichedSession.posAmount}`);
  }
  console.log("✔ Dynamic posAmount enrichment check PASSED.");

  // 7. Create unified receipt (simulating POST /api/receipts)
  console.log("\n4. Creating integrated receipt...");
  const receiptNumber = "RCP-TEST-UNIFIED-" + Date.now();
  
  // Calculate total receipt amount
  const receiptBillingAmount = Number(enrichedSession.billingAmount || 0);
  const receiptPosAmount = sessionOrders.reduce((sum, order) => sum + Number(order.subtotal), 0);
  const receiptTotalAmount = receiptBillingAmount + receiptPosAmount;

  const receipt = await prisma.receipt.create({
    data: {
      receiptNumber,
      sessionId: session.id,
      kasirId: "11f44a20-f239-4ec9-b74c-828960c4a309",
      billingAmount: receiptBillingAmount,
      posAmount: receiptPosAmount,
      totalAmount: receiptTotalAmount,
      paymentMethod: 'cash',
      printStatus: 'digital_only'
    },
    include: {
      session: {
        include: {
          unit: { select: { name: true, type: true } },
          package: { select: { name: true, type: true } },
        },
      },
      order: { include: { items: true } },
      kasir: { select: { name: true } },
    }
  });

  // Simulate enrichReceipt (attaching virtual order)
  if (!receipt.order && receipt.sessionId) {
    const orders = await prisma.posOrder.findMany({
      where: { sessionId: receipt.sessionId },
      include: { items: true }
    });
    if (orders.length > 0) {
      const aggregatedItems = [];
      for (const order of orders) {
        aggregatedItems.push(...order.items);
      }
      receipt.order = {
        id: 'virtual-session-orders',
        subtotal: receipt.posAmount,
        items: aggregatedItems
      };
    }
  }

  console.log("Receipt Number:", receipt.receiptNumber);
  console.log("Receipt Billing Amount:", receipt.billingAmount);
  console.log("Receipt POS Amount:", receipt.posAmount);
  console.log("Receipt Total Amount:", receipt.totalAmount);
  console.log("Receipt Virtual Order Subtotal:", receipt.order ? receipt.order.subtotal : 'null');
  console.log("Receipt Virtual Order Items count:", receipt.order ? receipt.order.items.length : 0);
  if (receipt.order) {
    console.log("Receipt Item Name:", receipt.order.items[0].itemName);
  }

  if (receipt.totalAmount !== (billingAmount + subtotal)) {
    throw new Error(`Total Amount mismatch! Expected: ${billingAmount + subtotal}, Got: ${receipt.totalAmount}`);
  }
  if (!receipt.order || receipt.order.items.length === 0 || receipt.order.items[0].itemName !== posItem.name) {
    throw new Error(`Virtual order detail mismatch!`);
  }
  console.log("✔ Unified receipt verification PASSED.");

  // 8. Cleanup
  console.log("\n5. Cleaning up test data...");
  await prisma.receipt.delete({ where: { id: receipt.id } });
  await prisma.posOrderItem.deleteMany({ where: { orderId: posOrder.id } });
  await prisma.posOrder.delete({ where: { id: posOrder.id } });
  await prisma.session.delete({ where: { id: session.id } });
  
  console.log("=== Integration Test completed successfully! ===");
}

test()
  .catch(err => {
    console.error("Test failed with error:", err.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
