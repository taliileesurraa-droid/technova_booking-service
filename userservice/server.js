const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
require('dotenv').config();

const { connectMongo } = require('./config/mongo');
const apiRoutes = require('./routes');
const { initializeSocket } = require('./services/socketService');
const positionUpdateService = require('./services/positionUpdate');

const app = express();

// ---------- MIDDLEWARE ----------
app.set('trust proxy', 1); // Fix for X-Forwarded-For header (rate-limit behind proxy)
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));

// Rate limiter
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
  })
);

// ---------- ROUTES ----------
app.get('/v1/health', (req, res) => res.json({ ok: true }));
app.use('/v1', apiRoutes);

// ---------- SERVER ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
initializeSocket(io);

const PORT = process.env.BOOKING_PORT || process.env.PORT || 4000;
connectMongo()
  .then(() => {
    
    
    // Start position update service
    positionUpdateService.start();
    
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((e) => {
    console.error('Failed to connect Mongo', e);
    process.exit(1);
  });