require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const passport = require("passport");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require("express-session");
const MongoStore =require('connect-mongo');
const flash = require("connect-flash");
const path = require("path");
const fs = require('fs');
const { execSync } = require('child_process');
const cors = require('cors');
const app = express();
const frontendUrl = process.env.FRONTEND_URL;
const customStrategy = require('./strategy');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

app.set('trust proxy', 1);
app.use(cors({ 
  origin: frontendUrl, 
  credentials: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

//Additional headers for CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', frontendUrl);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Middleware to parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("view engine", 'ejs');
app.set("views", path.join(__dirname, "views"));

const automataRoutes = require('./routes/automataroutes.js');
const userRoutes = require("./routes/userroutes.js");
const User = require('./models/User.js');



// Path to the .env file
const envFilePath = path.join(__dirname, '.env');

// Function to reload the .env file after generating secrets
const reloadEnv = () => {
    for (const key in process.env) {
        if (key.startsWith('SECRET') || key.startsWith('JWT_SECRET')) {
            delete process.env[key];
        }
    }
    require('dotenv').config(); // Re-load the .env file
};

// Check if .env file exists or if necessary environment variables are missing
if (!fs.existsSync(envFilePath) || !process.env.JWT_SECRET || !process.env.SECRET) {
    console.log('Generating missing secrets...');
    execSync('node generateEnv.js', { stdio: 'inherit' });
    reloadEnv();
}
// MongoDB connection
const mongoUrl ="mongodb://127.0.0.1:27017/AutomataWeaver";
const db_url=process.env.ATLASDB_URL;
async function main() {
    await mongoose.connect(db_url);
    console.log("connected to DB");
}
main().catch(err => console.log(err));

const store = MongoStore.create({
  mongoUrl:db_url,
  crypto:{
   secret:process.env.SECRET,
  },
  touchAfter:43200, //12 hours 
 
 });
 
  store.on("error",()=>
  {
     console.log("ERROR IN MONGO SESSION STORE",err);
  });
  
// Session options
const sessionOptions = {
    store:store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // Use secure cookies in production
        sameSite:  'none' // Required for cross-site cookies in production
    }
};



app.use(session(sessionOptions));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
passport.use(customStrategy);

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
},
async function(accessToken, refreshToken, profile, done) {
  try {
      const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
      if (!email) {
          return done(new Error('No email found in Google profile'));
      }

      let user = await User.findOne({ $or: [{ googleId: profile.id }, { email: email }] });
      
      if (!user) {
          user = new User({
              username: profile.displayName,
              googleId: profile.id,
              email: email 
          });
          await user.save();
      } else if (!user.googleId) {
          user.googleId = profile.id;
          await user.save();
      }

      return done(null, user);
  } catch (err) {
      return done(err);
  }
}));
// Passport configuration
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id)
    .then(user => done(null, user))
    .catch(err => done(err, null));
});

 //add user to local variables
app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  next();
});


// Routes
app.use('/api', userRoutes);
app.use('/api/automata', automataRoutes);

// Test root route
app.get("/", (req, res) => {
    res.render('landing');
});
app.get("/redirect",(req,res)=>
{
  res.render('redirect');
});

// Add a health check endpoint before your error handler
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
  });
});


// Error-handling middleware 
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: "An unexpected error occurred",
        error: process.env.NODE_ENV === "production" ? {} : err.message
    });
});

const keepServerActive = () => {
  const url = process.env.RENDER_EXTERNAL_URL;
  
  setInterval(async () => {
      try {
          const response = await fetch(`${url}/api/health`);
          if (response.ok) {
              console.log(`Keep-alive ping successful at ${new Date().toISOString()}`);
          } else {
              throw new Error(`Health check failed with status: ${response.status}`);
          }
      } catch (error) {
          console.error('Keep-alive ping failed:', error);
      }
  }, 13 * 60 * 1000); // 13 minutes
};


const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`server is listening to port ${port}`);
    
    // Only start the keep-alive in production
    if (process.env.NODE_ENV === 'production') {
        keepServerActive();
        console.log('Keep-alive mechanism activated');
    }
});





