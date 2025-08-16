CREATE DATABASE TinderDB2;
USE TinderDB2;

-- ===================
-- Lookup Tables
-- ===================

CREATE TABLE Gender (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(50) NOT NULL
);

INSERT INTO Gender (Name)
VALUES 
  ('Male'),
  ('Female'),
  ('Non-binary'),
  ('Other');

CREATE TABLE RelationshipTypes (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    Name VARCHAR(100) NOT NULL
);

CREATE TABLE AdminActionTypes (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    Name ENUM('Verify', 'Ban', 'Warn') NOT NULL
);

-- ===================
-- Core User Table
-- ===================

CREATE TABLE `User` (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    Username VARCHAR(50) NOT NULL,
    DateOfBirth DATE NOT NULL,
    Email VARCHAR(100) NOT NULL UNIQUE,
    Password VARCHAR(255) NOT NULL,
    PhoneNumber VARCHAR(20),
    Bio TEXT,
    GenderID INT,
    Latitude DECIMAL(9,6),        -- Added for location tracking
    Longitude DECIMAL(9,6),       -- Added for location tracking
    Role ENUM('user', 'admin') DEFAULT 'user',
    Active BOOLEAN DEFAULT TRUE,
    Verified BOOLEAN DEFAULT FALSE,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (GenderID) REFERENCES Gender(ID)
);

-- ===================
-- Pictures Table
-- ===================

CREATE TABLE Pictures (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    Picture TEXT NOT NULL,
    UserID INT,
    IsProfilePicture BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (UserID) REFERENCES `User`(ID)
);

-- ===================
-- Swipe Table
-- ===================

CREATE TABLE Swipe (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    DateCreated DATETIME DEFAULT CURRENT_TIMESTAMP,
    SwiperID INT NOT NULL,
    SwipedID INT NOT NULL,
    Liked BOOLEAN NOT NULL,
    UNIQUE (SwiperID, SwipedID),
    FOREIGN KEY (SwiperID) REFERENCES `User`(ID),
    FOREIGN KEY (SwipedID) REFERENCES `User`(ID)
);

-- ===================
-- Match Table
-- ===================

CREATE TABLE `Match` (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    DateCreated DATETIME DEFAULT CURRENT_TIMESTAMP,
    User1ID INT NOT NULL,
    User2ID INT NOT NULL,
    FOREIGN KEY (User1ID) REFERENCES `User`(ID),
    FOREIGN KEY (User2ID) REFERENCES `User`(ID)
);

-- ===================
-- Conversation & Messages
-- ===================

CREATE TABLE Conversation (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    MatchID INT NOT NULL,
    DateCreated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (MatchID) REFERENCES `Match`(ID)
);

CREATE TABLE Messages (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    ConversationID INT NOT NULL,
    SenderID INT NOT NULL,
    Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    Content TEXT NOT NULL,
    FOREIGN KEY (ConversationID) REFERENCES Conversation(ID),
    FOREIGN KEY (SenderID) REFERENCES `User`(ID)
);

-- ===================
-- Preferences Tables
-- ===================

CREATE TABLE PreferredGender (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    UserID INT NOT NULL,
    GenderID INT NOT NULL,
    FOREIGN KEY (UserID) REFERENCES `User`(ID),
    FOREIGN KEY (GenderID) REFERENCES Gender(ID)
);

CREATE TABLE LookingFor (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    UserID INT NOT NULL,
    RelationshipTypeID INT NOT NULL,
    FOREIGN KEY (UserID) REFERENCES `User`(ID),
    FOREIGN KEY (RelationshipTypeID) REFERENCES RelationshipTypes(ID)
);

CREATE TABLE UserPreferences (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    UserID INT NOT NULL,
    GenderID INT,
    MaxDistance INT DEFAULT 50,  -- Added MaxDistance preference
    MinAge INT DEFAULT 18,
    MaxAge INT DEFAULT 99,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UserID) REFERENCES `User`(ID),
    FOREIGN KEY (GenderID) REFERENCES Gender(ID)
);

-- ===================
-- Admin Actions
-- ===================

CREATE TABLE AdminActions (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    AdminID INT NOT NULL,
    UserID INT NOT NULL,
    ActionTypeID INT NOT NULL,
    DateCreated DATETIME DEFAULT CURRENT_TIMESTAMP,
    Reason TEXT,
    FOREIGN KEY (AdminID) REFERENCES `User`(ID),
    FOREIGN KEY (UserID) REFERENCES `User`(ID),
    FOREIGN KEY (ActionTypeID) REFERENCES AdminActionTypes(ID)
);

-- ===================
-- Blocked Users
-- ===================

CREATE TABLE BlockedUsers (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    BlockerID INT NOT NULL,
    BlockedID INT NOT NULL,
    DateCreated DATETIME DEFAULT CURRENT_TIMESTAMP,
    Reason TEXT,
    FOREIGN KEY (BlockerID) REFERENCES `User`(ID),
    FOREIGN KEY (BlockedID) REFERENCES `User`(ID)
);

-- ===================
-- Sessions
-- ===================

CREATE TABLE Session (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    UserID INT NOT NULL,
    Token VARCHAR(255) NOT NULL,
    ExpiryDate DATETIME,
    FOREIGN KEY (UserID) REFERENCES `User`(ID)
);

-- ===================
-- User Activity Log
-- ===================

CREATE TABLE UserActivity (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    UserID INT NOT NULL,
    Action ENUM('Login', 'Swipe', 'Match', 'MessageSent') NOT NULL,
    Timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UserID) REFERENCES `User`(ID)
);

-- ===================
-- User Reports Table
-- ===================

CREATE TABLE UserReports (
    ID INT PRIMARY KEY AUTO_INCREMENT,
    ReporterID INT NOT NULL,
    ReportedID INT NOT NULL,
    Reason TEXT NOT NULL,
    Status ENUM('Pending', 'Reviewed', 'Dismissed') DEFAULT 'Pending',
    DateCreated DATETIME DEFAULT CURRENT_TIMESTAMP,
    DateReviewed DATETIME NULL,
    ReviewedByAdminID INT NULL,
    FOREIGN KEY (ReporterID) REFERENCES `User`(ID),
    FOREIGN KEY (ReportedID) REFERENCES `User`(ID),
    FOREIGN KEY (ReviewedByAdminID) REFERENCES `User`(ID),
    UNIQUE KEY unique_report (ReporterID, ReportedID)
);