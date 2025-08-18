const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PAYMENTS_DIR = path.join(__dirname, 'payment-proofs');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Configure multer for payment proofs
const paymentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PAYMENTS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const paymentUpload = multer({ storage: paymentStorage });

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PAYMENTS_DIR)) fs.mkdirSync(PAYMENTS_DIR, { recursive: true });

// Initialize files if they don't exist
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
if (!fs.existsSync(CONTENT_FILE)) fs.writeFileSync(CONTENT_FILE, JSON.stringify({ items: [] }, null, 2));
if (!fs.existsSync(PAYMENTS_FILE)) fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ payments: [] }, null, 2));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/payment-proofs', express.static(PAYMENTS_DIR));

// Helper functions
function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function writeUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
function readContent() {
  return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
}
function writeContent(data) {
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2));
}
function readPayments() {
  return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'));
}
function writePayments(data) {
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
}

function deletePaymentProof(filename) {
  try {
    const filePath = path.join(PAYMENTS_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (err) {
    console.error('Error deleting payment proof:', err);
    return false;
  }
}

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// User authentication
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const usersData = readUsers();
    const user = usersData.users.find(u => u.username === username && u.password === password);

    if (!user) {
      if (username === 'admin' && password === 'admin123') {
        return res.json({
          success: true,
          username: 'admin',
          firstname: 'Admin',
          isAdmin: true
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      success: true,
      username: user.username,
      firstname: user.firstname,
      isAdmin: false
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// User registration
app.post('/api/register', (req, res) => {
  try {
    const { username, password, firstname, phone } = req.body;
    if (!username || !password || !firstname || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const usersData = readUsers();
    const existingUser = usersData.users.find(u => u.username === username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const newUser = { username, password, firstname, phone };
    usersData.users.push(newUser);
    writeUsers(usersData);

    res.json({ success: true, username, firstname });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Content endpoints
app.get('/api/content', (req, res) => {
  try {
    res.json(readContent());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read content' });
  }
});

app.get('/api/content/:id', (req, res) => {
  try {
    const { id } = req.params;
    const contentData = readContent();
    const item = contentData.items.find(item => item.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read content' });
  }
});

app.post('/api/content', upload.single('media'), (req, res) => {
  try {
    const { title, type, description, projectTitle } = req.body;
    const filename = req.file.filename;

    const contentData = readContent();
    const newItem = {
      id: Date.now().toString(),
      title,
      projectTitle,
      type,
      filename,
      description,
      uploadDate: new Date().toISOString(),
      likes: 0,
      comments: [],
      likedBy: []
    };

    contentData.items.unshift(newItem);
    writeContent(contentData);

    // Emit new content to all clients
    io.emit('content-updated', contentData.items);

    res.json({ success: true, item: newItem });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload content' });
  }
});

app.delete('/api/content/:id', (req, res) => {
  try {
    const { id } = req.params;
    const contentData = readContent();
    const itemIndex = contentData.items.findIndex(item => item.id === id);

    if (itemIndex === -1) return res.status(404).json({ error: 'Item not found' });

    const filename = contentData.items[itemIndex].filename;
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    contentData.items.splice(itemIndex, 1);
    writeContent(contentData);

    // Emit content update to all clients
    io.emit('content-updated', contentData.items);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// Comments
app.get('/api/get-comments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const contentData = readContent();
    const item = contentData.items.find(item => item.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item.comments || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read comments' });
  }
});

app.post('/api/content/:id/comments', (req, res) => {
  try {
    const { id } = req.params;
    const { username, text } = req.body;

    const contentData = readContent();
    const itemIndex = contentData.items.findIndex(item => item.id === id);
    if (itemIndex === -1) return res.status(404).json({ error: 'Item not found' });

    const usersData = readUsers();
    const user = usersData.users.find(u => u.username === username);

    const newComment = {
      id: Date.now().toString(),
      authorUsername: username,
      authorFirstName: user ? user.firstname : 'User',
      text,
      date: new Date().toISOString()
    };

    contentData.items[itemIndex].comments.unshift(newComment);
    writeContent(contentData);

    // Emit comment update to all clients
    io.emit('comment-added', { itemId: id, comment: newComment });

    res.json({ success: true, comment: newComment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Likes toggle
app.post('/api/content/:id/likes', (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;

    const contentData = readContent();
    const itemIndex = contentData.items.findIndex(item => item.id === id);
    if (itemIndex === -1) return res.status(404).json({ error: 'Item not found' });

    if (!contentData.items[itemIndex].likedBy) {
      contentData.items[itemIndex].likedBy = [];
    }

    const userLikes = contentData.items[itemIndex].likedBy;
    const alreadyLiked = userLikes.includes(username);

    if (alreadyLiked) {
      contentData.items[itemIndex].likedBy = userLikes.filter(u => u !== username);
    } else {
      contentData.items[itemIndex].likedBy.push(username);
    }

    contentData.items[itemIndex].likes = contentData.items[itemIndex].likedBy.length;
    writeContent(contentData);

    // Emit like update to all clients
    io.emit('like-updated', { 
      itemId: id, 
      likes: contentData.items[itemIndex].likes,
      likedBy: contentData.items[itemIndex].likedBy 
    });

    res.json({
      success: true,
      likes: contentData.items[itemIndex].likes,
      liked: !alreadyLiked
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// Payment endpoints
app.post('/api/submit-payment', paymentUpload.single('paymentProof'), (req, res) => {
  try {
    const { username } = req.body;
    const filename = req.file.filename;

    const paymentsData = readPayments();
    const newPayment = {
      id: Date.now().toString(),
      username,
      proofFilename: filename,
      status: 'pending', // pending, approved, rejected
      date: new Date().toISOString()
    };

    paymentsData.payments.unshift(newPayment);
    writePayments(paymentsData);

    // Emit new payment to admin clients
    io.emit('payment-added', newPayment);

    res.json({ success: true, payment: newPayment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit payment' });
  }
});

app.get('/api/check-payment', (req, res) => {
  try {
    const { username } = req.query;
    const paymentsData = readPayments();
    
    // Find the latest payment for this user
    const userPayments = paymentsData.payments.filter(p => p.username === username);
    const latestPayment = userPayments[0]; // Most recent is first
    
    if (!latestPayment) {
      return res.json({ verified: false });
    }

    res.json({ 
      verified: latestPayment.status === 'approved',
      payment: latestPayment
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Admin payment management
app.get('/api/admin/payments', (req, res) => {
  try {
    const paymentsData = readPayments();
    const usersData = readUsers();

    // Enrich payment data with user info
    const enrichedPayments = paymentsData.payments.map(payment => {
      const user = usersData.users.find(u => u.username === payment.username);
      return {
        ...payment,
        userFirstName: user ? user.firstname : 'Unknown',
        userPhone: user ? user.phone : 'Unknown'
      };
    });

    res.json({ payments: enrichedPayments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

app.post('/api/admin/payments/:id/approve', (req, res) => {
  try {
    const { id } = req.params;
    const paymentsData = readPayments();
    const paymentIndex = paymentsData.payments.findIndex(p => p.id === id);

    if (paymentIndex === -1) return res.status(404).json({ error: 'Payment not found' });

    // Get filename before updating status
    const proofFilename = paymentsData.payments[paymentIndex].proofFilename;
    
    paymentsData.payments[paymentIndex].status = 'approved';
    writePayments(paymentsData);

    // Delete the payment proof file after approval
    deletePaymentProof(proofFilename);

    // Emit payment approval to all clients
    io.emit('payment-approved', { 
      paymentId: id,
      username: paymentsData.payments[paymentIndex].username
    });

    // Remove approved payment from the list
    paymentsData.payments.splice(paymentIndex, 1);
    writePayments(paymentsData);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve payment' });
  }
});

app.post('/api/admin/payments/:id/reject', (req, res) => {
  try {
    const { id } = req.params;
    const paymentsData = readPayments();
    const paymentIndex = paymentsData.payments.findIndex(p => p.id === id);

    if (paymentIndex === -1) return res.status(404).json({ error: 'Payment not found' });

    // Get filename before updating status
    const proofFilename = paymentsData.payments[paymentIndex].proofFilename;
    
    paymentsData.payments[paymentIndex].status = 'rejected';
    writePayments(paymentsData);

    // Delete the payment proof file after rejection
    deletePaymentProof(proofFilename);

    // Emit payment rejection to all clients
    io.emit('payment-rejected', { paymentId: id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

// Analytics
app.get('/api/analytics', (req, res) => {
  try {
    const contentData = readContent();
    const paymentsData = readPayments();
    const items = [...contentData.items];

    const mostLiked = items.sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5);

    const totalArtworks = items.length;
    const totalLikes = items.reduce((sum, item) => sum + (item.likes || 0), 0);
    const totalComments = items.reduce((sum, item) => sum + (item.comments?.length || 0), 0);
    const pendingPayments = paymentsData.payments.filter(p => p.status === 'pending').length;

    res.json({
      mostLiked,
      stats: { totalArtworks, totalLikes, totalComments, pendingPayments }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Serve static files and pages
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/item-detail', (req, res) => res.sendFile(path.join(__dirname, 'public', 'item-detail.html')));
app.get('/payments', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payments.html')));

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
