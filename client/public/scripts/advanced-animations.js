document.addEventListener('DOMContentLoaded', function() {

    
    // === Floating particles animation ===
    const particles = document.querySelectorAll('.particle');
    
    particles.forEach((particle, index) => {
        // Random initial positions
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const size = Math.random() * 30 + 10;
        const delay = Math.random() * 5;
        const duration = Math.random() * 20 + 15;
        const opacity = Math.random() * 0.5 + 0.1;
        
        // Apply initial styles
        particle.style.left = `${x}vw`;
        particle.style.top = `${y}vh`;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.opacity = opacity;
        particle.style.animationDelay = `${delay}s`;
        particle.style.animationDuration = `${duration}s`;
    });
    
    // === GSAP animations ===
    // Hero section advanced animations
    gsap.from('.hero h1', {
        duration: 1.5,
        y: 50,
        opacity: 0,
        ease: 'power4.out',
        stagger: 0.2
    });
    
    gsap.from('.hero p', {
        duration: 1.5,
        y: 30,
        opacity: 0,
        ease: 'power3.out',
        delay: 0.4
    });
    
    gsap.from('.hero .btn', {
        duration: 1,
        scale: 0.8,
        opacity: 0,
        ease: 'back.out(1.7)',
        delay: 0.8
    });
    
    // Scroll animations for features
    gsap.registerPlugin(ScrollTrigger);
    
    // Feature cards staggered entrance
    gsap.from('.feature-card', {
        scrollTrigger: {
            trigger: '#features',
            start: 'top 80%',
        },
        y: 100,
        opacity: 0,
        duration: 0.8,
        stagger: 0.2,
        ease: 'back.out(1.2)'
    });
    
    // Access cards reveal
    gsap.from('.access-card', {
        scrollTrigger: {
            trigger: '#get-started',
            start: 'top 75%',
        },
        x: function(i) { return i % 2 === 0 ? -100 : 100; },
        opacity: 0,
        duration: 1,
        stagger: 0.3,
        ease: 'power3.out'
    });
    
    // Magnetic buttons effect
    const magneticButtons = document.querySelectorAll('.btn, .nav-link');
    
    magneticButtons.forEach(btn => {
        btn.addEventListener('mousemove', function(e) {
            const rect = this.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            
            // Adjust the divisor to control sensitivity
            this.style.transform = `translate(${x/8}px, ${y/8}px)`;
        });
        
        btn.addEventListener('mouseleave', function() {
            this.style.transform = 'translate(0, 0)';
        });
    });
    
    // Text splitting for hero title
    const heroTitle = document.querySelector('.hero h1');
    if (heroTitle) {
        const text = heroTitle.innerHTML;
        const words = text.split(' ');
        
        let newText = '';
        words.forEach((word, index) => {
            if (word.includes('<span>')) {
                newText += `<span class="word special">${word}</span> `;
            } else {
                newText += `<span class="word">${word}</span> `;
            }
        });
        
        heroTitle.innerHTML = newText;
        
        // Animate each word
        const wordElements = heroTitle.querySelectorAll('.word');
        gsap.from(wordElements, {
            opacity: 0,
            y: 30,
            rotateX: -30,
            stagger: 0.15,
            duration: 1.2,
            ease: "power3.out",
            delay: 0.3
        });
    }
    
    // Disable custom cursor on mobile
    function handleViewportChange() {
        if (window.innerWidth <= 768) {
            document.body.classList.remove('custom-cursor');
        } else {
            document.body.classList.add('custom-cursor');
        }
    }
    
    // Initial check
    handleViewportChange();
    
    // Listen for window resize
    window.addEventListener('resize', handleViewportChange);
});
