// client/public/scripts/profile.js

// Import Firebase services and functions needed
import { storage } from './firebase.js'; // Import the initialized storage instance
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js"; // Import v9 functions

// DOM Elements (Keep these as they are)
const userNameDisplay = document.getElementById('user-name');
const userEmailDisplay = document.getElementById('user-email');
const userStudentIdDisplay = document.getElementById('user-student-id');
const studentIdSection = document.getElementById('student-id-section');
const userAccountTypeDisplay = document.getElementById('user-account-type');
const profileImageDisplay = document.getElementById('profile-image-display');
const profileImageUpload = document.getElementById('profile-image-upload');
const changePictureButton = document.getElementById('change-picture-button');
const uploadPictureButton = document.getElementById('upload-picture-button');
const editNameButton = document.getElementById('edit-name-button');
const editNameSection = document.getElementById('edit-name-section');
const newNameInput = document.getElementById('new-name-input');
const saveNameButton = document.getElementById('save-name-button');
const cancelEditNameButton = document.getElementById('cancel-edit-name-button');
const changePasswordForm = document.getElementById('change-password-form');
const currentPasswordInput = document.getElementById('current-password');
const newPasswordInput = document.getElementById('new-password');
const confirmPasswordInput = document.getElementById('confirm-password');
const passwordChangeStatus = document.getElementById('password-change-status');
const deleteAccountButton = document.getElementById('delete-account-button');
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const confirmDeleteButton = document.getElementById('confirm-delete-button');
const cancelDeleteButton = document.getElementById('cancel-delete-button');
const closeModalButton = deleteConfirmModal.querySelector('.close-button');
const logoutButton = document.getElementById('logout-button'); // Assuming this ID exists in header
const navDashboardLink = document.getElementById('nav-dashboard');

let currentUserId = null;
let currentUserType = null; // 'student' or 'instructor'
let currentUserData = null; // Full data from RTDB
let selectedFile = null;
let currentProfileImageUrl = 'images/default-instructor.webp'; // Default image

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', async () => {
    await fetchAndLoadUserProfile();
    setupEventListeners(); // Setup listeners after fetching initial data
});

// --- Fetch User Profile Data (Backend API) ---
async function fetchAndLoadUserProfile() {
    try {
        console.log("Fetching profile data from /api/profile/data...");
        const response = await fetch('/api/profile/data'); // Use the new backend endpoint

        if (!response.ok) {
            // Handle authentication errors (401) or other server errors
            if (response.status === 401) {
                console.error("Authentication required. Redirecting to login.");
                // Redirect based on a guess or to a generic login page
                // Ideally, the server could provide a hint or the client knows the context
                window.location.href = '/index.html'; // Redirect to home/login selection
            } else {
                console.error(`Error fetching profile data: ${response.status} ${response.statusText}`);
                throw new Error(`Server error ${response.status}`);
            }
            return; // Stop execution
        }

        const result = await response.json();

        if (result.success && result.profile) {
            currentUserData = result.profile; // Store the fetched profile data
            console.log("Fetched profile data:", currentUserData);

            // Determine user type and ID from the fetched data
            // The backend determines this based on the session and RTDB structure
            // We need a way to know the ID and type on the client now.
            // Let's assume the backend adds `_id` and `_type` to the profile object for convenience
            // Modify backend if necessary to include this. For now, we derive it.
            if (currentUserData.student_number !== undefined) { // Heuristic: student data has student_number
                currentUserType = 'student';
                // Find the ID - this is brittle, relies on backend structure not changing
                // It's better if backend explicitly provides the ID used in the path
                // Let's assume backend adds `userId` or `studentId` to the profile object
                currentUserId = currentUserData.studentId || null; // Adjust if backend sends a different key
                if (!currentUserId) console.warn("Could not determine student ID from profile data.");

            } else {
                currentUserType = 'instructor';
                // Assume backend adds `userId`
                currentUserId = currentUserData.userId || null; // Adjust if backend sends a different key
                if (!currentUserId) console.warn("Could not determine instructor ID from profile data.");
            }
            console.log(`Determined user type: ${currentUserType}, ID: ${currentUserId}`);

            // Update UI elements
            userEmailDisplay.textContent = currentUserData.email || 'N/A';
            userNameDisplay.textContent = currentUserData.name || 'N/A';
            currentProfileImageUrl = currentUserData.profilePictureUrl || 'images/default-instructor.webp';
            profileImageDisplay.src = currentProfileImageUrl;

            // Set hidden username field for password change form accessibility
            const usernameInput = document.getElementById('username-for-password-change');
            if (usernameInput && currentUserData.email) {
                usernameInput.value = currentUserData.email;
            }

            if (currentUserType === 'instructor') {
                userAccountTypeDisplay.textContent = 'Instructor';
                studentIdSection.style.display = 'none';
                if (navDashboardLink) navDashboardLink.href = '/instructor.html';
            } else { // Student
                userAccountTypeDisplay.textContent = 'Student';
                if (currentUserData.student_number && currentUserData.student_number !== 'STAFF') {
                    userStudentIdDisplay.textContent = currentUserData.student_number;
                    studentIdSection.style.display = 'block';
                } else {
                    studentIdSection.style.display = 'none';
                }
                if (navDashboardLink) navDashboardLink.href = '/student_dashboard.html';
            }

        } else {
            console.error("Failed to get profile data from backend:", result.error || 'Unknown error');
            throw new Error(result.error || 'Failed to parse profile data');
        }

    } catch (error) {
        console.error("Error fetching or loading profile:", error);
        userNameDisplay.textContent = 'Error Loading Profile';
        userEmailDisplay.textContent = 'Error';
        profileImageDisplay.src = 'images/default-instructor.webp'; // Fallback image
        // Optionally redirect or show a persistent error message
        // Consider redirecting if auth fails consistently
        // window.location.href = '/index.html';
    }
}


// --- Event Listeners Setup (Should be called after initial load) ---
function setupEventListeners() {
    // Profile Picture
    changePictureButton.addEventListener('click', () => profileImageUpload.click());
    profileImageUpload.addEventListener('change', handleFileSelect);
    uploadPictureButton.addEventListener('click', handlePictureUpload);

    // Edit Name
    editNameButton.addEventListener('click', toggleNameEdit);
    saveNameButton.addEventListener('click', handleNameSave);
    cancelEditNameButton.addEventListener('click', toggleNameEdit); // Also cancels

    // Change Password
    changePasswordForm.addEventListener('submit', handleChangePassword);

    
        // Delete Account Modal Handling
        function showDeleteModal() {
            deleteConfirmModal.classList.add('show');
        }
        function hideDeleteModal() {
            deleteConfirmModal.classList.remove('show');
        }
    
        deleteAccountButton.addEventListener('click', showDeleteModal);
        closeModalButton.addEventListener('click', hideDeleteModal);
        cancelDeleteButton.addEventListener('click', hideDeleteModal);
        confirmDeleteButton.addEventListener('click', handleDeleteAccount);
        window.addEventListener('click', (event) => { // Close modal if clicked outside content
            if (event.target == deleteConfirmModal) { // Click on the overlay itself
                hideDeleteModal();
            }
        });
    // Logout
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
}

// --- Profile Picture Handling ---
function handleFileSelect(event) {
    selectedFile = event.target.files[0];
    if (selectedFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            profileImageDisplay.src = e.target.result; // Show preview
        }
        reader.readAsDataURL(selectedFile);
        uploadPictureButton.style.display = 'inline-block'; // Show upload button
        changePictureButton.textContent = 'Cancel'; // Change button text
        changePictureButton.removeEventListener('click', () => profileImageUpload.click());
        changePictureButton.addEventListener('click', cancelPictureChange); // Add cancel listener
    }
}

function cancelPictureChange() {
    selectedFile = null;
    profileImageUpload.value = ''; // Clear file input
    profileImageDisplay.src = currentProfileImageUrl; // Revert to original image
    uploadPictureButton.style.display = 'none';
    changePictureButton.textContent = 'Change Picture';
    changePictureButton.removeEventListener('click', cancelPictureChange);
    changePictureButton.addEventListener('click', () => profileImageUpload.click()); // Re-add original listener
}


async function handlePictureUpload() {
    if (!selectedFile || !currentUserId || !currentUserType) return;

    uploadPictureButton.disabled = true;
    uploadPictureButton.textContent = 'Uploading...';

    // Construct Storage path (using user ID)
    const fileExtension = selectedFile.name.split('.').pop();
    const filePath = `profileImages/${currentUserId}/profile.${fileExtension}`; // Consistent filename
    const storageRef = ref(storage, filePath); // Use v9 ref() function

    try {
        // Upload new image using v9 uploadBytes
        const snapshot = await uploadBytes(storageRef, selectedFile);
        const newImageUrl = await getDownloadURL(snapshot.ref); // Use v9 getDownloadURL()

        // Update the profile picture URL via the backend API
        const updateResponse = await fetch('/api/profile/update-picture-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newImageUrl: newImageUrl })
        });

        const updateResult = await updateResponse.json();
        if (!updateResponse.ok || !updateResult.success) {
            throw new Error(updateResult.error || 'Failed to update profile picture URL in database.');
        }

        // Delete old image from Storage if it wasn't the default and URL changed
        if (currentProfileImageUrl && !currentProfileImageUrl.includes('default-instructor.webp') && currentProfileImageUrl !== newImageUrl) {
             try {
                 // Get ref from URL for deletion using v9 ref()
                 const oldImageRef = ref(storage, currentProfileImageUrl);
                 await deleteObject(oldImageRef); // Use v9 deleteObject()
                 console.log("Old profile image deleted.");
             } catch (deleteError) {
                 // Log error but continue, maybe the old URL was invalid or deleted already
                 console.warn("Could not delete old profile image:", deleteError);
                 // Common errors: 'storage/object-not-found', 'storage/invalid-argument' (if URL format is wrong)
                 if (deleteError.code === 'storage/object-not-found') {
                     console.log("Old image likely already deleted or URL was incorrect.");
                 }
             }
         }

        // Update UI
        currentProfileImageUrl = newImageUrl; // Update the current URL
        profileImageDisplay.src = newImageUrl;
        cancelPictureChange(); // Reset buttons and selection state

        console.log("Profile picture updated successfully!");
        alert("Profile picture updated!");

    } catch (error) {
        console.error("Error uploading profile picture:", error);
        alert(`Error uploading picture: ${error.message}. Please try again.`);
        // Revert UI changes if needed
         profileImageDisplay.src = currentProfileImageUrl; // Revert preview
    } finally {
        uploadPictureButton.disabled = false;
        uploadPictureButton.textContent = 'Upload Picture';
    }
}


// --- Name Edit Handling ---
function toggleNameEdit() {
    const isEditing = editNameSection.style.display === 'block';
    if (isEditing) {
        // Hide edit section, show display
        editNameSection.style.display = 'none';
        userNameDisplay.style.display = 'inline';
        editNameButton.textContent = 'Edit';
        newNameInput.value = ''; // Clear input
    } else {
        // Show edit section, hide display
        newNameInput.value = userNameDisplay.textContent; // Pre-fill with current name
        editNameSection.style.display = 'block';
        userNameDisplay.style.display = 'none';
        editNameButton.textContent = 'Cancel'; // Temporarily change button function
        newNameInput.focus();
    }
}

async function handleNameSave() {
    const newName = newNameInput.value.trim();
    // Use currentUserData (fetched from backend) for checks
    if (!newName || !currentUserId || !currentUserType || (currentUserData && newName === currentUserData.name)) {
        toggleNameEdit(); // Just close if no change or invalid state
        return;
    }

    saveNameButton.disabled = true;
    saveNameButton.textContent = 'Saving...';

    try {
        // Update name via the backend API
        const response = await fetch('/api/profile/update-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName: newName })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to update name via backend.');
        }

        // Update local data and UI
        if (currentUserData) { // Update local cache if it exists
             currentUserData.name = newName;
        }
        userNameDisplay.textContent = newName;
        toggleNameEdit(); // Close edit section
        console.log("Name updated successfully!");

    } catch (error) {
        console.error("Error updating name:", error);
        alert(`Error updating name: ${error.message}. Please try again.`);
    } finally {
        saveNameButton.disabled = false;
        saveNameButton.textContent = 'Save';
    }
}

// --- Password Change Handling ---
async function handleChangePassword(event) {
    event.preventDefault();
    // Clear and hide previous status
    passwordChangeStatus.textContent = '';
    passwordChangeStatus.className = 'status-message'; // Reset classes
    passwordChangeStatus.style.display = 'none';

    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    // Helper function to show status messages
    const showStatus = (message, isError = true) => {
        passwordChangeStatus.textContent = message;
        passwordChangeStatus.classList.add(isError ? 'error' : 'success');
        passwordChangeStatus.style.display = 'inline-block'; // Or 'block' if preferred
    };

    // Basic client-side validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        showStatus("Please fill in all password fields.");
        return;
    }
    if (newPassword !== confirmPassword) {
        showStatus("New passwords do not match.");
        return;
    }
    if (newPassword.length < 8) { // Match server validation
        showStatus("New password must be at least 8 characters long.");
        return;
    }
    if (!currentUserType) {
        showStatus("Error: User type unknown.");
        return;
    }

    // Determine the correct endpoint
    const endpoint = currentUserType === 'instructor' ? '/instructor/change_password' : '/student/change_password';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Send current and new password to the backend
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showStatus("Password updated successfully!", false); // false indicates not an error
            changePasswordForm.reset(); // Clear the form
        } else {
            // Display error message from the server
            showStatus(`Error: ${result.error || 'Failed to change password.'}`);
        }
    } catch (error) {
        console.error("Error calling change password endpoint:", error);
        showStatus("A network error occurred. Please try again.");
    }
}

// --- Account Deletion Handling ---
async function handleDeleteAccount() {
    if (!currentUserType) {
         alert("Error: Cannot determine user type for deletion.");
         hideDeleteModal();
         return;
    }

    // Prompt for current password for verification
    const currentPassword = prompt("For security, please enter your current password to confirm account deletion:");

    if (currentPassword === null) { // User cancelled prompt
        // Don't close modal, let them cancel explicitly
        return;
    }
    if (!currentPassword) {
        alert("Password is required to delete your account.");
        // Keep modal open for retry
        return;
    }

    confirmDeleteButton.disabled = true;
    confirmDeleteButton.textContent = 'Deleting...';
    cancelDeleteButton.disabled = true; // Disable cancel while deleting

    // Determine the correct endpoint
    const endpoint = currentUserType === 'instructor' ? '/instructor/delete_account' : '/student/delete_account';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword }) // Send password for verification
        });

        const result = await response.json();

        if (response.ok && result.success) {
            console.log("User account deletion successful via backend.");
            hideDeleteModal(); // Hide modal before alert/redirect
            alert("Your account has been permanently deleted.");
            // Server handles session destruction, client just redirects
            window.location.href = '/index.html'; // Redirect after successful deletion
        } else {
             // Display error from server
             alert(`Error deleting account: ${result.error || 'Failed to delete account.'}`);
             // Re-enable buttons and keep modal open on error
             confirmDeleteButton.disabled = false;
             confirmDeleteButton.textContent = 'Yes, Delete My Account';
             cancelDeleteButton.disabled = false;
        }
    } catch (error) {
        console.error("Error calling delete account endpoint:", error);
        alert("A network error occurred during account deletion. Please try again.");
        // Re-enable buttons and keep modal open on error
        confirmDeleteButton.disabled = false;
        confirmDeleteButton.textContent = 'Yes, Delete My Account';
        cancelDeleteButton.disabled = false;
    }
}


// --- Logout Handling ---
function handleLogout() {
    // Redirect to the server's logout endpoint based on user type
    // The server endpoint will handle session destruction and redirection.
    if (currentUserType === 'instructor') {
        window.location.href = '/instructor/logout';
    } else if (currentUserType === 'student') {
        window.location.href = '/student/logout';
    } else {
        // Fallback if type is unknown (shouldn't happen if initial load worked)
        console.warn("Cannot determine user type for logout.");
        window.location.href = '/index.html'; // Go to home page
    }
}