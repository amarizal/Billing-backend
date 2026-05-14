const { Server } = require('socket.io');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] New connection: ${socket.id}`);

    socket.on('register_tv', (data) => {
      console.log(`[Socket] TV Registered: ${data.unitId}`);
      socket.join(data.unitId); // Join a room specific to the TV unit
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIo() {
  if (!io) {
    throw new Error('Socket.io is not initialized!');
  }
  return io;
}

module.exports = { initSocket, getIo };
