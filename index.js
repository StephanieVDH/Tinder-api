// Importeren van de express module in node_modules
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('./classes/database.js');
const multer = require('multer');
const bcrypt = require('bcrypt');
const path = require('path'); // Add this import

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

// IMPORTANT: Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
      'SELECT ID, Email, Password, Role FROM `User` WHERE Email = ? AND Active = TRUE',
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

    // Success - Return user info
    return res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.ID,
        email: user.Email,
        role: user.Role
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error during login.' });
  } finally {
    await connection.end();
  }
});

// 3. User profile page
// 1. Get user profile by ID
app.get('/api/profile/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    // Fetch user details
    const [userRows] = await connection.execute(
      `SELECT 
        u.ID,
        u.Username,
        u.DateOfBirth,
        u.Email,
        u.PhoneNumber,
        u.Bio,
        u.GenderID,
        g.Name as GenderName
      FROM User u
      LEFT JOIN Gender g ON u.GenderID = g.ID
      WHERE u.ID = ? AND u.Active = TRUE`,
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch user's profile picture
    const [pictureRows] = await connection.execute(
      `SELECT Picture 
       FROM Pictures 
       WHERE UserID = ? AND IsProfilePicture = TRUE
       LIMIT 1`,
      [userId]
    );

    // Fix: Add the full URL for the profile picture
    let profilePictureUrl = null;
    if (pictureRows.length > 0 && pictureRows[0].Picture) {
      // If it's already a full URL, use it as is, otherwise prepend the server URL
      profilePictureUrl = pictureRows[0].Picture.startsWith('http') 
        ? pictureRows[0].Picture 
        : `http://localhost:3000${pictureRows[0].Picture}`;
    }

    res.json({
      profile: userRows[0],
      profilePictureUrl: profilePictureUrl
    });

  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  } finally {
    await connection.end();
  }
});

// 2. Update user profile
app.put('/api/profile/:id', upload.single('profilePicture'), async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    const { Bio, GenderID, PhoneNumber } = req.body;

    // Update user profile
    await connection.execute(
      `UPDATE User 
       SET Bio = ?, 
           GenderID = ?, 
           PhoneNumber = ?,
           UpdatedAt = CURRENT_TIMESTAMP
       WHERE ID = ?`,
      [Bio || null, GenderID || null, PhoneNumber || null, userId]
    );

    // Handle profile picture upload if provided
    if (req.file) {
      const imageUrl = `/uploads/${req.file.filename}`;
      
      // First, set all existing pictures to not be profile picture
      await connection.execute(
        `UPDATE Pictures 
         SET IsProfilePicture = FALSE 
         WHERE UserID = ?`,
        [userId]
      );

      // Check if user already has pictures
      const [existingPictures] = await connection.execute(
        `SELECT ID FROM Pictures WHERE UserID = ? LIMIT 1`,
        [userId]
      );

      if (existingPictures.length > 0) {
        // Update the first picture to be the new profile picture
        await connection.execute(
          `UPDATE Pictures 
           SET Picture = ?, IsProfilePicture = TRUE 
           WHERE UserID = ? 
           LIMIT 1`,
          [imageUrl, userId]
        );
      } else {
        // Insert new profile picture
        await connection.execute(
          `INSERT INTO Pictures (Picture, UserID, IsProfilePicture) 
           VALUES (?, ?, TRUE)`,
          [imageUrl, userId]
        );
      }
    }

    res.json({ message: 'Profile updated successfully' });

  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  } finally {
    await connection.end();
  }
});

// 3. Get available genders
app.get('/api/genders', async (req, res) => {
  const connection = await db.connect();
  
  try {
    const [genderRows] = await connection.execute(
      `SELECT ID, Name FROM Gender ORDER BY ID`
    );
    
    res.json(genderRows);
    
  } catch (err) {
    console.error('Error fetching genders:', err);
    res.status(500).json({ error: 'Failed to fetch genders' });
  } finally {
    await connection.end();
  }
});

// 4. Get user preferences
app.get('/api/preferences/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    // Check if user has preferences
    const [prefRows] = await connection.execute(
      `SELECT 
        up.GenderID,
        up.MaxDistance,
        up.MinAge,
        up.MaxAge
      FROM UserPreferences up
      WHERE up.UserID = ?`,
      [userId]
    );

    if (prefRows.length > 0) {
      res.json(prefRows[0]);
    } else {
      // Return default preferences if none exist
      res.json({
        GenderID: null,
        MaxDistance: 50,
        MinAge: 18,
        MaxAge: 99
      });
    }

  } catch (err) {
    console.error('Error fetching preferences:', err);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  } finally {
    await connection.end();
  }
});

// 5. Update user preferences
app.put('/api/preferences/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    const { GenderID, MaxDistance, MinAge, MaxAge } = req.body;

    // Check if preferences exist
    const [existing] = await connection.execute(
      `SELECT ID FROM UserPreferences WHERE UserID = ?`,
      [userId]
    );

    if (existing.length > 0) {
      // Update existing preferences
      await connection.execute(
        `UPDATE UserPreferences 
         SET GenderID = ?,
             MaxDistance = ?,
             MinAge = ?,
             MaxAge = ?
         WHERE UserID = ?`,
        [GenderID || null, MaxDistance || 50, MinAge || 18, MaxAge || 99, userId]
      );
    } else {
      // Insert new preferences
      await connection.execute(
        `INSERT INTO UserPreferences 
         (UserID, GenderID, MaxDistance, MinAge, MaxAge) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, GenderID || null, MaxDistance || 50, MinAge || 18, MaxAge || 99]
      );
    }

    // Also update PreferredGender table if GenderID is provided
    if (GenderID) {
      // Delete existing preferred genders
      await connection.execute(
        `DELETE FROM PreferredGender WHERE UserID = ?`,
        [userId]
      );
      
      // Insert new preferred gender
      await connection.execute(
        `INSERT INTO PreferredGender (UserID, GenderID) VALUES (?, ?)`,
        [userId, GenderID]
      );
    }

    res.json({ message: 'Preferences updated successfully' });

  } catch (err) {
    console.error('Error updating preferences:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  } finally {
    await connection.end();
  }
});


// SWIPE ENDPOINTS:
// 1. Load users for swiping
app.get('/api/users/swipe/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  try {
    const [userRows] = await connection.execute(
      `SELECT ID, Username, DateOfBirth, Bio
       FROM User
       WHERE ID != ? AND Role = 'user' AND Active = TRUE`,
      [userId]
    );

    const [pictureRows] = await connection.execute(
      `SELECT UserID, Picture FROM Pictures`
    );

    // Group pictures by userID
    const picturesMap = {};
    pictureRows.forEach(pic => {
      if (!picturesMap[pic.UserID]) picturesMap[pic.UserID] = [];
      // Fix: Add full URL for pictures
      const fullUrl = pic.Picture.startsWith('http') 
        ? pic.Picture 
        : `http://localhost:3000${pic.Picture}`;
      picturesMap[pic.UserID].push(fullUrl);
    });

    const users = userRows.map(user => {
      const age = new Date().getFullYear() - new Date(user.DateOfBirth).getFullYear();
      return {
        id: user.ID,
        name: user.Username,
        age,
        bio: user.Bio,
        pictures: picturesMap[user.ID] || ['https://via.placeholder.com/300x300?text=User']
      };
    });

    res.json(users);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load users' });
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

// 4. Delete users
app.delete('/api/admin/users/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  try {
    const [result] = await connection.execute(
      'DELETE FROM User WHERE ID = ?',
      [userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  } finally {
    await connection.end();
  }
});






// Starten van de server en op welke port de server moet luisteren, NIET VERWIJDEREN
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});