// server/utils/verification.js
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

// Ensure environment variables are loaded
dotenv.config();

// In-memory storage for verification codes (will be lost on server restart)
// In a production environment, consider using Redis or a database
const verificationCodes = new Map();

/**
 * Generates a random verification code
 * @param {number} length - Length of the verification code 
 * @returns {string} - The generated verification code
 */
function generateVerificationCode(length = 6) {
  // Generate a random numeric code
  return crypto.randomInt(100000, 999999).toString().padStart(length, '0');
}

/**
 * Stores a verification code for a specific email with expiration
 * @param {string} email - The email address
 * @param {string} code - The verification code
 * @param {number} expiresInMinutes - Code expiration time in minutes
 * @returns {Object} - Object with code and expiration timestamp
 */
function storeVerificationCode(email, code, expiresInMinutes = 10) {
  const expiresAt = Date.now() + (expiresInMinutes * 60 * 1000);
  const verificationData = { code, expiresAt, attempts: 0 };
  verificationCodes.set(email.toLowerCase(), verificationData);
  return verificationData;
}

/**
 * Validates a verification code for an email
 * @param {string} email - The email address
 * @param {string} code - The verification code to validate
 * @returns {Object} - Object with validation result and message
 */
function validateVerificationCode(email, code) {
  const verificationData = verificationCodes.get(email.toLowerCase());
  
  // No verification code found
  if (!verificationData) {
    return { 
      valid: false, 
      message: 'No verification code found. Please request a new one.' 
    };
  }
  
  // Track verification attempts
  verificationData.attempts += 1;
  
  // Too many attempts (5 max)
  if (verificationData.attempts > 5) {
    verificationCodes.delete(email.toLowerCase());
    return { 
      valid: false, 
      message: 'Too many attempts. Please request a new verification code.' 
    };
  }
  
  // Code expired
  if (Date.now() > verificationData.expiresAt) {
    verificationCodes.delete(email.toLowerCase());
    return { 
      valid: false, 
      message: 'Verification code has expired. Please request a new one.' 
    };
  }
  
  // Code doesn't match
  if (verificationData.code !== code) {
    return { 
      valid: false, 
      message: 'Invalid verification code. Please try again.' 
    };
  }
  
  // Code is valid
  verificationCodes.delete(email.toLowerCase());
  return { 
    valid: true, 
    message: 'Verification successful!' 
  };
}

/**
 * Creates a nodemailer transporter based on environment variables
 * @returns {Object} - Nodemailer transport object
 */
function createMailTransporter() {
  // Create a transporter using environment variables
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
  
  return transporter;
}

/**
 * Sends a verification email
 * @param {string} email - Recipient email address
 * @param {string} name - Recipient name
 * @param {string} code - Verification code
 * @param {string} userType - Type of user (student or instructor)
 * @returns {Promise} - Promise that resolves when email is sent
 */
async function sendVerificationEmail(email, name, code, userType) {
  try {
    const transporter = createMailTransporter();
    
    // Define the email content
    const mailOptions = {
      from: `"Lecture Assistant" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2>Verify Your Email</h2>
          <p>Hello ${name},</p>
          <p>Thank you for signing up for Lecture Assistant as a ${userType}. To complete your registration, please use the following verification code:</p>
          <div style="background-color: #f4f4f4; padding: 15px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px;">
            ${code}
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you did not request this code, please ignore this email.</p>
          <p>Regards,<br>Lecture Assistant Team</p>
        </div>
      `
    };
    
    // Send the email
    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending verification email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validates an email address format
 * @param {string} email - The email to validate
 * @param {string} type - Either 'student' or 'instructor'
 * @returns {Object} - Object with validation result and message
 */
function validateEmailFormat(email, type) {
  if (!email) {
    return { valid: false, message: 'Email is required' };
  }
  
  email = email.toLowerCase();
  
  // General email format validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return { valid: false, message: 'Invalid email format' };
  }
  
  // Specific validation based on user type
  if (type === 'student') {
    // Student email must be in the format xxxxxxx@students.adu.ac.ae
    // where x's are numeric student ID
    const studentEmailRegex = /^[0-9]+@students\.adu\.ac\.ae$/;
    if (!studentEmailRegex.test(email)) {
      return { 
        valid: false, 
        message: 'Student email must be in the format studentID@students.adu.ac.ae' 
      };
    }
  } else if (type === 'instructor') {
    // Instructor email must be in the format firstname.lastname@adu.ac.ae
    const instructorEmailRegex = /^[a-zA-Z]+\.[a-zA-Z]+@adu\.ac\.ae$/;
    if (!instructorEmailRegex.test(email)) {
      return { 
        valid: false, 
        message: 'Instructor email must be in the format firstname.lastname@adu.ac.ae' 
      };
    }
  }
  
  return { valid: true, message: 'Email format is valid' };
}

module.exports = {
  generateVerificationCode,
  storeVerificationCode,
  validateVerificationCode,
  sendVerificationEmail,
  validateEmailFormat
};