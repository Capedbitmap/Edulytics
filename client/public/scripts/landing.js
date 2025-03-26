// client/public/scripts/landing.js

document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const joinCodeInput = document.getElementById('join-code');
    const joinLectureBtn = document.getElementById('join-lecture-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    
    // Format lecture codes as uppercase
    if (joinCodeInput) {
        joinCodeInput.addEventListener('input', function() {
            this.value = this.value.toUpperCase();
        });
    }
    
    // Join Lecture button click
    if (joinLectureBtn) {
        joinLectureBtn.addEventListener('click', async function() {
            const code = joinCodeInput.value.trim().toUpperCase();
            
            if (!code || code.length !== 6) {
                showError('join-lecture-error', 'Please enter a valid 6-character lecture code');
                return;
            }
            
            showLoading(true);
            
            try {
                // Check if lecture exists
                const response = await fetch('/join_lecture', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        lecture_code: code
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Redirect to lecture page
                    window.location.href = `/lecture/${code}`;
                } else {
                    showError('join-lecture-error', data.error || 'Invalid lecture code');
                    showLoading(false);
                }
            } catch (error) {
                console.error('Error joining lecture:', error);
                showError('join-lecture-error', 'Error joining lecture. Please try again.');
                showLoading(false);
            }
        });
    }
    
    // Helper functions
    function showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (!errorElement) return;
        
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
    
    function showLoading(show) {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    }
    
    // Add keyboard shortcut for Enter key
    joinCodeInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            joinLectureBtn.click();
        }
    });
});