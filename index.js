// Importeren van de express module in node_modules
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('./classes/database.js');
const multer = require('multer');
const bcrypt = require('bcrypt');

const db = new Database();

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

// ALLES HIERBOVEN LATEN STAAN!!

// USER ACCOUNT ENDPOINTS:
// 1. registration endpoint
app.post('/api/register', upload.array('pictures', 5), async (req, res) => {
  const connection = await db.connect();
  try {
    const { firstName, dob, gender, email, password } = req.body;

    // age check: must be 18+
    const birth = new Date(dob);
    const ageMs = Date.now() - birth.getTime();
    const age = Math.abs(new Date(ageMs).getUTCFullYear() - 1970);
    if (age < 18) {
      return res.status(400).json({ error: 'You have to be at least 18 years to swipe.' });
    }

   // helper: map a gender name to its ID in Gender table
    async function getGenderId(genderName, connection) {
      const [rows] = await connection.execute(
        'SELECT ID FROM Gender WHERE Name = ?',
        [genderName]
      );
      if (rows.length) return rows[0].ID;
      throw new Error(`Unknown gender option: ${genderName}`);
    } 

    // lookup gender ID
    const genderId = await getGenderId(gender, connection);

    // Password hashing
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // insert into User table
    const [userResult] = await connection.execute(
      `INSERT INTO \`User\`
         (Username, DateOfBirth, Email, GenderID, Password)
       VALUES (?, ?, ?, ?, ?)`,
      [ firstName, dob, email, genderId, passwordHash ]
    );
    const userId = userResult.insertId;

    // insert uploaded pictures into Pictures table
    await Promise.all(req.files.map((file, idx) => {
      const imageUrl = `/uploads/${file.filename}`;
      return connection.execute(
        `INSERT INTO Pictures
           (Picture, UserID, IsProfilePicture)
         VALUES (?, ?, ?)`,
        [ imageUrl, userId, idx === 0 ? 1 : 0 ]
      );
    }));

    // success
    return res.status(201).json({ message: 'Success!' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    await connection.end();
  }
});

// 2. login endpoint
app.post('/api/login', async (req, res) => {
  const connection = await db.connect();
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Fetch user by email
    const [rows] = await connection.execute(
      'SELECT ID, Password FROM `User` WHERE Email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.Password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Success
    return res.status(200).json({ message: 'Login successful.', userId: user.ID });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    await connection.end();
  }
});


// ADMIN ENDPOINTS:
// 1. User overview
app.get('/api/admin/users', async (req, res) => {
  const connection = await db.connect();
  try {
    const [rows] = await connection.execute(
      'SELECT ID, Username, Email, Role, Active, Verified, CreatedAt FROM User'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  } finally {
    await connection.end();
  }
});

// 2. Ban users
app.put('/api/admin/users/:id/ban', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  try {
    const [rows] = await connection.execute(
      'SELECT Active FROM User WHERE ID = ?',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentStatus = rows[0].Active;
    const newStatus = !currentStatus;

    await connection.execute(
      'UPDATE User SET Active = ? WHERE ID = ?',
      [newStatus, userId]
    );

    res.json({ message: `User ${newStatus ? 'unbanned' : 'banned'}`, active: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user status' });
  } finally {
    await connection.end();
  }
});

// 3. Verify users
app.put('/api/admin/users/:id/verify', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  try {
    const [rows] = await connection.execute(
      'SELECT Verified FROM User WHERE ID = ?',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentStatus = rows[0].Verified;
    const newStatus = !currentStatus;

    await connection.execute(
      'UPDATE User SET Verified = ? WHERE ID = ?',
      [newStatus, userId]
    );

    res.json({ message: `User ${newStatus ? 'verified' : 'unverified'}`, verified: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update verification status' });
  } finally {
    await connection.end();
  }
});







// Starten van de server en op welke port de server moet luisteren, NIET VERWIJDEREN
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
  