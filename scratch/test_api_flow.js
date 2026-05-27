const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  console.log("Starting API flow test...");

  // 1. Get a unit
  const unit = await prisma.unit.findFirst({
    where: { isActive: true, status: 'available' }
  });
  if (!unit) {
    console.error("No active available unit found!");
    return;
  }
  console.log("Using unit:", unit.name, "ID:", unit.id);

  // 2. Get a package
  const pkg = await prisma.package.findFirst({
    where: { isActive: true }
  });
  if (!pkg) {
    console.error("No active package found!");
    return;
  }
  console.log("Using package:", pkg.name, "ID:", pkg.id);

  // 3. Create a session
  console.log("Creating session...");
  const startTime = new Date();
  let plannedEndTime = new Date(startTime.getTime() + pkg.durationMinutes * 60000);
  const session = await prisma.session.create({
    data: {
      unitId: unit.id,
      kasirId: "11f44a20-f239-4ec9-b74c-828960c4a309", // Use the valid kasirId from our inspection
      packageId: pkg.id,
      startTime,
      plannedEndTime,
      status: 'active'
    }
  });
  console.log("Created session ID:", session.id);

  // 4. Update unit status
  await prisma.unit.update({
    where: { id: unit.id },
    data: { status: 'in_use' }
  });

  // 5. Try stopping the session (simulating PUT /api/sessions/:id/stop)
  console.log("Stopping session...");
  const endTime = new Date();
  const durationMs = endTime - session.startTime;
  const durationMinutes = Math.ceil(durationMs / 60000);
  
  let billingAmount = 0;
  if (pkg.type === 'package') {
    billingAmount = Number(pkg.price);
  } else if (pkg.type === 'hourly') {
    const pricePerMinute = Number(pkg.price) / 60;
    billingAmount = Math.ceil(pricePerMinute * durationMinutes);
  }
  const finalBillingAmount = billingAmount + Number(session.accumulatedBillingAmount || 0);

  const updatedSession = await prisma.session.update({
    where: { id: session.id },
    data: {
      endTime,
      durationMinutes,
      billingAmount: finalBillingAmount,
      status: 'completed'
    }
  });
  console.log("Stopped session:", updatedSession.status, "Billing amount:", updatedSession.billingAmount);

  // 6. Try creating receipt (simulating POST /api/receipts)
  console.log("Creating receipt...");
  const receiptNumber = "TEST-RCP-" + Date.now();
  const receipt = await prisma.receipt.create({
    data: {
      receiptNumber,
      sessionId: session.id,
      kasirId: "11f44a20-f239-4ec9-b74c-828960c4a309",
      billingAmount: updatedSession.billingAmount,
      posAmount: 0,
      totalAmount: updatedSession.billingAmount,
      paymentMethod: 'cash',
      printStatus: 'digital_only'
    }
  });
  console.log("Created receipt successfully! Receipt Number:", receipt.receiptNumber);

  // Cleanup: delete receipt and session, restore unit
  await prisma.receipt.delete({ where: { id: receipt.id } });
  await prisma.session.delete({ where: { id: session.id } });
  await prisma.unit.update({
    where: { id: unit.id },
    data: { status: 'available' }
  });
  console.log("Cleanup done, test passed successfully!");
}

test()
  .catch(err => {
    console.error("Test failed with error:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
