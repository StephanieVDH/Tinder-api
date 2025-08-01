// Importeren van de express module in node_modules
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('./classes/database.js');
const multer = require('multer');

// Aanmaken van een express app
const app = express();
const upload = multer({
  dest: 'uploads/', // Ensure this directory exists
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/'); // Ensure this directory exists
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  })
});

// Enable CORS
app.use(cors({
    origin: 'http://localhost:8080', // Allow requests from this origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
}));

// Middleware om JSON-requests te parsen
app.use(bodyParser.json());

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send({ error: 'No file uploaded' });
  }
  res.send({
    message: 'File uploaded successfully!',
    filePath: req.file.path,
  });
});

// Endpoints
app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Starten van de server en op welke port de server moet luisteren, NIET VERWIJDEREN
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

// ALLES HIERBOVEN LATEN STAAN!!

// USERS:
// API Route to Fetch User by ID (TEST)
app.get('/api/user', async (req, res) => {
  const userId = req.query.id;

  const db = new Database();
  
  try {
      const [user] = await db.getQuery(
          `SELECT 
              u.ID, u.Username, u.DateOfBirth, u.Email, u.PhoneNumber, 
              u.Bio, g.Name AS Gender, u.Location, u.Active, u.Verified, 
              u.MinAge, u.MaxAge 
          FROM User u
          LEFT JOIN Gender g ON u.GenderID = g.ID
          WHERE u.ID = ?`, 
          [userId]
      );

      if (user === undefined) {
          return res.status(404).json({ error: "User not found" });
      }

      res.json(user); // Return user data
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database error" });
  }
});

//2. User inloggen
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = new Database();

  db.getQuery('SELECT * FROM User WHERE Email = ?', [email])
    .then((users) => {
      if (users.length === 0) {
        return res.status(401).send({ error: 'Invalid email or password' });
      }

      const user = users[0];

      // Compare passwords
      if (user.Password !== password) {  // Note: using user.Password instead of User.Password
        return res.status(401).send({ error: 'Invalid email or password' });
      }

      // Successful login response
      res.status(200).send({
        message: 'Login successful',
        userId: user.ID,
        userType: user.UserType
      });
    })
    .catch((error) => {
      console.error('Login error:', error); // Add error logging
      res.status(500).send({ error: 'Failed to log in', details: error });
    });
});









  