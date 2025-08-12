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
        u.Latitude,
        u.Longitude,
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

// Updated API endpoints for multiple gender preferences

// 4. Get user preferences (UPDATED)
app.get('/api/preferences/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    // Get basic preferences
    const [prefRows] = await connection.execute(
      `SELECT 
        up.MaxDistance,
        up.MinAge,
        up.MaxAge
      FROM UserPreferences up
      WHERE up.UserID = ?`,
      [userId]
    );

    // Get selected gender preferences
    const [genderRows] = await connection.execute(
      `SELECT pg.GenderID 
       FROM PreferredGender pg
       WHERE pg.UserID = ?`,
      [userId]
    );

    const selectedGenders = genderRows.map(row => row.GenderID);

    if (prefRows.length > 0) {
      res.json({
        selectedGenders: selectedGenders,
        MaxDistance: prefRows[0].MaxDistance,
        MinAge: prefRows[0].MinAge,
        MaxAge: prefRows[0].MaxAge
      });
    } else {
      // Return default preferences if none exist
      res.json({
        selectedGenders: [],
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

// 5. Update user preferences (UPDATED)
app.put('/api/preferences/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    await connection.beginTransaction();

    const { selectedGenders, MaxDistance, MinAge, MaxAge } = req.body;

    // Validate selectedGenders is an array
    if (!Array.isArray(selectedGenders)) {
      return res.status(400).json({ error: 'selectedGenders must be an array' });
    }

    // Check if basic preferences exist
    const [existing] = await connection.execute(
      `SELECT ID FROM UserPreferences WHERE UserID = ?`,
      [userId]
    );

    if (existing.length > 0) {
      // Update existing basic preferences
      await connection.execute(
        `UPDATE UserPreferences 
         SET MaxDistance = ?,
             MinAge = ?,
             MaxAge = ?
         WHERE UserID = ?`,
        [MaxDistance || 50, MinAge || 18, MaxAge || 99, userId]
      );
    } else {
      // Insert new basic preferences
      await connection.execute(
        `INSERT INTO UserPreferences 
         (UserID, MaxDistance, MinAge, MaxAge) 
         VALUES (?, ?, ?, ?)`,
        [userId, MaxDistance || 50, MinAge || 18, MaxAge || 99]
      );
    }

    // Delete existing gender preferences
    await connection.execute(
      `DELETE FROM PreferredGender WHERE UserID = ?`,
      [userId]
    );
    
    // Insert new gender preferences
    if (selectedGenders.length > 0) {
      // Validate that all gender IDs exist
      const placeholders = selectedGenders.map(() => '?').join(',');
      const [validGenders] = await connection.execute(
        `SELECT ID FROM Gender WHERE ID IN (${placeholders})`,
        selectedGenders
      );

      if (validGenders.length !== selectedGenders.length) {
        await connection.rollback();
        return res.status(400).json({ error: 'One or more invalid gender IDs provided' });
      }

      // Insert all selected genders
      const insertPromises = selectedGenders.map(genderId => 
        connection.execute(
          `INSERT INTO PreferredGender (UserID, GenderID) VALUES (?, ?)`,
          [userId, genderId]
        )
      );
      
      await Promise.all(insertPromises);
    }

    await connection.commit();
    res.json({ message: 'Preferences updated successfully' });

  } catch (err) {
    await connection.rollback();
    console.error('Error updating preferences:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  } finally {
    await connection.end();
  }
});

// SWIPE ENDPOINTS:
// 1. Load users for swiping (excludes already swiped users) - UPDATED with location and distance filtering
app.get('/api/users/swipe/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  try {
    // Get current user's location first
    const [currentUserLocation] = await connection.execute(
      `SELECT Latitude, Longitude FROM User WHERE ID = ?`,
      [userId]
    );

    if (currentUserLocation.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userLat = currentUserLocation[0].Latitude;
    const userLng = currentUserLocation[0].Longitude;

    // Get user's preferred genders
    const [preferredGenders] = await connection.execute(
      `SELECT pg.GenderID 
       FROM PreferredGender pg
       WHERE pg.UserID = ?`,
      [userId]
    );

    // Get user's other preferences
    const [userPrefs] = await connection.execute(
      `SELECT MaxDistance, MinAge, MaxAge 
       FROM UserPreferences 
       WHERE UserID = ?`,
      [userId]
    );

    let genderFilter = '';
    let queryParams = [userId, userId];

    // If user has gender preferences, filter by them
    if (preferredGenders.length > 0) {
      const genderIds = preferredGenders.map(pg => pg.GenderID);
      const placeholders = genderIds.map(() => '?').join(',');
      genderFilter = `AND u.GenderID IN (${placeholders})`;
      queryParams.push(...genderIds);
    }

    // Add age filtering if preferences exist
    let ageFilter = '';
    if (userPrefs.length > 0) {
      const minAge = userPrefs[0].MinAge || 18;
      const maxAge = userPrefs[0].MaxAge || 99;
      ageFilter = `AND (YEAR(CURDATE()) - YEAR(u.DateOfBirth) - (RIGHT(CURDATE(), 5) < RIGHT(u.DateOfBirth, 5))) BETWEEN ? AND ?`;
      queryParams.push(minAge, maxAge);
    }

    // Get users that haven't been swiped yet, filtered by preferences and including location data
    const [userRows] = await connection.execute(
      `SELECT u.ID, u.Username, u.DateOfBirth, u.Bio, u.Latitude, u.Longitude
       FROM User u
       WHERE u.ID != ? 
       AND u.Role = 'user' 
       AND u.Active = TRUE
       AND u.Latitude IS NOT NULL 
       AND u.Longitude IS NOT NULL
       AND u.ID NOT IN (
         SELECT SwipedID FROM Swipe WHERE SwiperID = ?
       )
       ${genderFilter}
       ${ageFilter}
       ORDER BY u.CreatedAt DESC`,
      queryParams
    );

    const [pictureRows] = await connection.execute(
      `SELECT UserID, Picture FROM Pictures WHERE IsProfilePicture = TRUE`
    );

    // Group pictures by userID
    const picturesMap = {};
    pictureRows.forEach(pic => {
      if (!picturesMap[pic.UserID]) picturesMap[pic.UserID] = [];
      // Add full URL for pictures
      const fullUrl = pic.Picture.startsWith('http') 
        ? pic.Picture 
        : `http://localhost:3000${pic.Picture}`;
      picturesMap[pic.UserID].push(fullUrl);
    });

    // Calculate distances and filter by MaxDistance preference
    const maxDistance = userPrefs.length > 0 ? (userPrefs[0].MaxDistance || 50) : 50;
    
    const usersWithDistance = userRows.map(user => {
      // Calculate distance using Haversine formula
      const distance = calculateDistance(
        userLat, 
        userLng, 
        parseFloat(user.Latitude), 
        parseFloat(user.Longitude)
      );

      const age = new Date().getFullYear() - new Date(user.DateOfBirth).getFullYear();
      
      return {
        id: user.ID,
        name: user.Username,
        age,
        bio: user.Bio || 'No bio yet',
        latitude: user.Latitude,
        longitude: user.Longitude,
        distance: distance,
        picture: picturesMap[user.ID]?.[0],
        pictures: picturesMap[user.ID] || []
      };
    }).filter(user => user.distance <= maxDistance); // Filter by distance preference

    res.json(usersWithDistance);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load users' });
  } finally {
    await connection.end();
  }
});

// Helper function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// 2. Record a swipe (like or dislike)
app.post('/api/swipe', async (req, res) => {
  const connection = await db.connect();
  try {
    const { swiperId, swipedId, liked } = req.body;

    // Validate input
    if (!swiperId || !swipedId || liked === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Insert swipe record
    await connection.execute(
      `INSERT INTO Swipe (SwiperID, SwipedID, Liked, DateCreated) 
       VALUES (?, ?, ?, NOW())`,
      [swiperId, swipedId, liked]
    );

    // Check if it's a match (both users liked each other)
    let isMatch = false;
    if (liked) {
      const [reverseSwipe] = await connection.execute(
        `SELECT Liked FROM Swipe 
         WHERE SwiperID = ? AND SwipedID = ? AND Liked = TRUE`,
        [swipedId, swiperId]
      );

      if (reverseSwipe.length > 0) {
        // It's a match! Create match record
        isMatch = true;
        
        // Insert match record (ensure User1ID < User2ID for consistency)
        const user1Id = Math.min(swiperId, swipedId);
        const user2Id = Math.max(swiperId, swipedId);
        
        // Check if match doesn't already exist
        const [existingMatch] = await connection.execute(
          `SELECT ID FROM \`Match\` WHERE User1ID = ? AND User2ID = ?`,
          [user1Id, user2Id]
        );

        if (existingMatch.length === 0) {
          const [matchResult] = await connection.execute(
            `INSERT INTO \`Match\` (User1ID, User2ID, DateCreated) 
             VALUES (?, ?, NOW())`,
            [user1Id, user2Id]
          );

          // Create conversation for the match
          await connection.execute(
            `INSERT INTO Conversation (MatchID, DateCreated) 
             VALUES (?, NOW())`,
            [matchResult.insertId]
          );
        }
      }
    }

    res.json({ 
      message: 'Swipe recorded successfully',
      isMatch: isMatch 
    });

  } catch (err) {
    console.error('Error recording swipe:', err);
    res.status(500).json({ error: 'Failed to record swipe' });
  } finally {
    await connection.end();
  }
});

// 3. Get user's matches
app.get('/api/matches/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    const [matchRows] = await connection.execute(
      `SELECT 
        m.ID as matchId,
        m.DateCreated as matchDate,
        CASE 
          WHEN m.User1ID = ? THEN m.User2ID 
          ELSE m.User1ID 
        END as matchedUserId,
        u.Username as matchedUserName,
        u.Bio as matchedUserBio,
        p.Picture as matchedUserPicture
      FROM \`Match\` m
      JOIN User u ON u.ID = CASE 
        WHEN m.User1ID = ? THEN m.User2ID 
        ELSE m.User1ID 
      END
      LEFT JOIN Pictures p ON p.UserID = u.ID AND p.IsProfilePicture = TRUE
      WHERE (m.User1ID = ? OR m.User2ID = ?)
      ORDER BY m.DateCreated DESC`,
      [userId, userId, userId, userId]
    );

    const matches = matchRows.map(match => ({
      matchId: match.matchId,
      matchDate: match.matchDate,
      user: {
        id: match.matchedUserId,
        name: match.matchedUserName,
        bio: match.matchedUserBio,
        picture: match.matchedUserPicture 
          ? (match.matchedUserPicture.startsWith('http') 
              ? match.matchedUserPicture 
              : `http://localhost:3000${match.matchedUserPicture}`)
          : null
      }
    }));

    res.json(matches);

  } catch (err) {
    console.error('Error fetching matches:', err);
    res.status(500).json({ error: 'Failed to fetch matches' });
  } finally {
    await connection.end();
  }
});

// 4. Get swipe statistics for a user
app.get('/api/swipe-stats/:id', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    // Get total swipes made
    const [totalSwipes] = await connection.execute(
      `SELECT COUNT(*) as total FROM Swipe WHERE SwiperID = ?`,
      [userId]
    );

    // Get likes given
    const [likesGiven] = await connection.execute(
      `SELECT COUNT(*) as total FROM Swipe WHERE SwiperID = ? AND Liked = TRUE`,
      [userId]
    );

    // Get likes received
    const [likesReceived] = await connection.execute(
      `SELECT COUNT(*) as total FROM Swipe WHERE SwipedID = ? AND Liked = TRUE`,
      [userId]
    );

    // Get total matches
    const [matches] = await connection.execute(
      `SELECT COUNT(*) as total FROM \`Match\` WHERE User1ID = ? OR User2ID = ?`,
      [userId, userId]
    );

    res.json({
      totalSwipes: totalSwipes[0].total,
      likesGiven: likesGiven[0].total,
      likesReceived: likesReceived[0].total,
      matches: matches[0].total
    });

  } catch (err) {
    console.error('Error fetching swipe stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  } finally {
    await connection.end();
  }
});

// NEW: Get user's gender preference statistics
app.get('/api/preferences/:id/stats', async (req, res) => {
  const userId = req.params.id;
  const connection = await db.connect();
  
  try {
    // Get preferred genders with counts
    const [preferredGendersStats] = await connection.execute(
      `SELECT 
        g.Name as GenderName,
        g.ID as GenderID,
        COUNT(DISTINCT u.ID) as AvailableUsers
       FROM PreferredGender pg
       JOIN Gender g ON pg.GenderID = g.ID
       LEFT JOIN User u ON u.GenderID = g.ID 
         AND u.ID != ? 
         AND u.Active = TRUE 
         AND u.Role = 'user'
         AND u.ID NOT IN (SELECT SwipedID FROM Swipe WHERE SwiperID = ?)
       WHERE pg.UserID = ?
       GROUP BY g.ID, g.Name`,
      [userId, userId, userId]
    );

    // Get total available users matching preferences
    const [totalAvailable] = await connection.execute(
      `SELECT COUNT(DISTINCT u.ID) as total
       FROM User u
       WHERE u.ID != ? 
       AND u.Role = 'user' 
       AND u.Active = TRUE
       AND u.ID NOT IN (SELECT SwipedID FROM Swipe WHERE SwiperID = ?)
       AND u.GenderID IN (SELECT GenderID FROM PreferredGender WHERE UserID = ?)`,
      [userId, userId, userId]
    );

    res.json({
      preferredGenders: preferredGendersStats,
      totalAvailableUsers: totalAvailable[0]?.total || 0
    });

  } catch (err) {
    console.error('Error fetching preference stats:', err);
    res.status(500).json({ error: 'Failed to fetch preference statistics' });
  } finally {
    await connection.end();
  }
});

// MESSAGING ENDPOINTS:
// 1. Get conversations for a user
app.get('/api/conversations/:userId', async (req, res) => {
  const userId = req.params.userId;
  const connection = await db.connect();
  
  try {
    // Get all conversations with last message for each
    const [conversations] = await connection.execute(
      `SELECT 
        c.ID as conversationId,
        m.ID as matchId,
        CASE 
          WHEN m.User1ID = ? THEN m.User2ID 
          ELSE m.User1ID 
        END as otherUserId,
        u.Username as otherUserName,
        p.Picture as otherUserPicture,
        (SELECT Content FROM Messages 
         WHERE ConversationID = c.ID 
         ORDER BY Timestamp DESC LIMIT 1) as lastMessage,
        (SELECT Timestamp FROM Messages 
         WHERE ConversationID = c.ID 
         ORDER BY Timestamp DESC LIMIT 1) as lastMessageTime,
        (SELECT SenderID FROM Messages 
         WHERE ConversationID = c.ID 
         ORDER BY Timestamp DESC LIMIT 1) as lastMessageSender,
        (SELECT COUNT(*) FROM Messages 
         WHERE ConversationID = c.ID 
         AND SenderID != ? 
         AND Timestamp > COALESCE(
           (SELECT MAX(Timestamp) FROM Messages 
            WHERE ConversationID = c.ID AND SenderID = ?), 
           '1970-01-01')) as unreadCount
      FROM Conversation c
      JOIN \`Match\` m ON c.MatchID = m.ID
      JOIN User u ON u.ID = CASE 
        WHEN m.User1ID = ? THEN m.User2ID 
        ELSE m.User1ID 
      END
      LEFT JOIN Pictures p ON p.UserID = u.ID AND p.IsProfilePicture = TRUE
      WHERE m.User1ID = ? OR m.User2ID = ?
      ORDER BY 
        CASE 
          WHEN (SELECT Timestamp FROM Messages WHERE ConversationID = c.ID ORDER BY Timestamp DESC LIMIT 1) IS NULL 
          THEN 1 
          ELSE 0 
        END,
        (SELECT Timestamp FROM Messages WHERE ConversationID = c.ID ORDER BY Timestamp DESC LIMIT 1) DESC,
        c.DateCreated DESC`,
      [userId, userId, userId, userId, userId, userId]
    );

    const formattedConversations = conversations.map(conv => ({
      conversationId: conv.conversationId,
      matchId: conv.matchId,
      otherUser: {
        id: conv.otherUserId,
        name: conv.otherUserName,
        picture: conv.otherUserPicture 
          ? (conv.otherUserPicture.startsWith('http') 
              ? conv.otherUserPicture 
              : `http://localhost:3000${conv.otherUserPicture}`)
          : null
      },
      lastMessage: conv.lastMessage,
      lastMessageTime: conv.lastMessageTime,
      lastMessageSender: conv.lastMessageSender,
      unreadCount: conv.unreadCount || 0,
      hasMessages: !!conv.lastMessage
    }));

    res.json(formattedConversations);

  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  } finally {
    await connection.end();
  }
});

// 2. Get messages for a specific conversation
app.get('/api/conversations/:conversationId/messages', async (req, res) => {
  const conversationId = req.params.conversationId;
  const connection = await db.connect();
  
  try {
    // Get all messages for this conversation
    const [messages] = await connection.execute(
      `SELECT 
        m.ID as messageId,
        m.Content as content,
        m.SenderID as senderId,
        m.Timestamp as timestamp,
        u.Username as senderName,
        p.Picture as senderPicture
      FROM Messages m
      JOIN User u ON m.SenderID = u.ID
      LEFT JOIN Pictures p ON p.UserID = u.ID AND p.IsProfilePicture = TRUE
      WHERE m.ConversationID = ?
      ORDER BY m.Timestamp ASC`,
      [conversationId]
    );

    const formattedMessages = messages.map(msg => ({
      messageId: msg.messageId,
      content: msg.content,
      senderId: msg.senderId,
      senderName: msg.senderName,
      senderPicture: msg.senderPicture 
        ? (msg.senderPicture.startsWith('http') 
            ? msg.senderPicture 
            : `http://localhost:3000${msg.senderPicture}`)
        : null,
      timestamp: msg.timestamp
    }));

    res.json(formattedMessages);

  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  } finally {
    await connection.end();
  }
});

// 3. Send a new message
app.post('/api/conversations/:conversationId/messages', async (req, res) => {
  const conversationId = req.params.conversationId;
  const { senderId, content } = req.body;
  const connection = await db.connect();
  
  try {
    // Validate that the sender is part of this conversation
    const [validation] = await connection.execute(
      `SELECT m.ID 
       FROM Conversation c
       JOIN \`Match\` m ON c.MatchID = m.ID
       WHERE c.ID = ? 
       AND (m.User1ID = ? OR m.User2ID = ?)`,
      [conversationId, senderId, senderId]
    );

    if (validation.length === 0) {
      return res.status(403).json({ error: 'You are not part of this conversation' });
    }

    // Insert the message
    const [result] = await connection.execute(
      `INSERT INTO Messages (ConversationID, SenderID, Content, Timestamp) 
       VALUES (?, ?, ?, NOW())`,
      [conversationId, senderId, content]
    );

    // Get the inserted message with sender info
    const [newMessage] = await connection.execute(
      `SELECT 
        m.ID as messageId,
        m.Content as content,
        m.SenderID as senderId,
        m.Timestamp as timestamp,
        u.Username as senderName,
        p.Picture as senderPicture
      FROM Messages m
      JOIN User u ON m.SenderID = u.ID
      LEFT JOIN Pictures p ON p.UserID = u.ID AND p.IsProfilePicture = TRUE
      WHERE m.ID = ?`,
      [result.insertId]
    );

    const formattedMessage = {
      messageId: newMessage[0].messageId,
      content: newMessage[0].content,
      senderId: newMessage[0].senderId,
      senderName: newMessage[0].senderName,
      senderPicture: newMessage[0].senderPicture 
        ? (newMessage[0].senderPicture.startsWith('http') 
            ? newMessage[0].senderPicture 
            : `http://localhost:3000${newMessage[0].senderPicture}`)
        : null,
      timestamp: newMessage[0].timestamp
    };

    res.json({
      message: 'Message sent successfully',
      data: formattedMessage
    });

  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  } finally {
    await connection.end();
  }
});

// 4. Get or create conversation by match ID
app.get('/api/matches/:matchId/conversation', async (req, res) => {
  const matchId = req.params.matchId;
  const connection = await db.connect();
  
  try {
    // Check if conversation already exists
    const [existing] = await connection.execute(
      `SELECT ID FROM Conversation WHERE MatchID = ?`,
      [matchId]
    );

    let conversationId;
    
    if (existing.length > 0) {
      conversationId = existing[0].ID;
    } else {
      // Create new conversation
      const [result] = await connection.execute(
        `INSERT INTO Conversation (MatchID, DateCreated) VALUES (?, NOW())`,
        [matchId]
      );
      conversationId = result.insertId;
    }

    res.json({ conversationId });

  } catch (err) {
    console.error('Error getting/creating conversation:', err);
    res.status(500).json({ error: 'Failed to get conversation' });
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