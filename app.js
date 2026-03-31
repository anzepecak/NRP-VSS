class DB {
    static init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ZenJournalDB', 2);
            request.onerror = e => reject(e.target.error);
            request.onsuccess = e => resolve(e.target.result);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('dreams')) {
                    db.createObjectStore('dreams', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('users')) {
                    db.createObjectStore('users', { keyPath: 'email' });
                }
            };
        });
    }

    static async getAll() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('dreams', 'readonly');
            const request = tx.objectStore('dreams').getAll();
            request.onsuccess = () => resolve(request.result.sort((a,b) => b.id - a.id));
            request.onerror = () => reject('Error fetching dreams');
        });
    }

    static async add(dream) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('dreams', 'readwrite');
            const request = tx.objectStore('dreams').add(dream);
            request.onsuccess = () => resolve();
            request.onerror = () => reject('Error saving dream');
        });
    }

    static async getUser(email) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('users', 'readonly');
            const request = tx.objectStore('users').get(email);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject('Error fetching user');
        });
    }

    static async addUser(user) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('users', 'readwrite');
            const request = tx.objectStore('users').add(user);
            request.onsuccess = () => resolve();
            request.onerror = () => reject('Error saving user');
        });
    }
}

class ZenApp {
    constructor() {
        this.currentView = 'home';
        this.currentSpaceIndex = 0;
        this.isRecording = false;
        this.recordingTimer = null;
        this.recordingSeconds = 0;
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.speechRecognition = null;
        this.transcription = "";
        
        // Caching DOM elements
        this.views = {
            auth: document.getElementById('view-auth'),
            home: document.getElementById('view-home'),
            zenspace: document.getElementById('view-zenspace'),
            recorder: document.getElementById('view-recorder'),
            gallery: document.getElementById('view-gallery')
        };
        
        this.topNav = document.querySelector('.top-nav');
        this.actionLogout = document.getElementById('logout-btn');
        this.actionCancel = document.querySelector('.action-cancel');
        this.audioWaves = document.getElementById('audio-waves');
        this.recordStatus = document.getElementById('record-status');
        this.recordPrompt = document.getElementById('record-prompt');
        this.micBtn = document.getElementById('mic-btn');
        this.recTime = document.getElementById('rec-time');
        this.recFill = document.getElementById('rec-fill');
        this.modal = document.getElementById('generating-modal');
        
        // Temporary mock gallery images (using abstract unsplash gradients)
        this.mockGeneratedImages = [
            'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=600',
            'https://images.unsplash.com/photo-1557672172-298e090bd0f1?q=80&w=600',
            'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=600'
        ];
        
        this.init();
    }
    
    init() {
        // Initial setup
        this.actionCancel.style.display = 'none';
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.avatar-container')) {
                const dropdown = document.getElementById('avatar-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            }
        });
        
        try {
            this.currentUser = JSON.parse(localStorage.getItem('zen_user') || 'null');
        } catch(e) {
            this.currentUser = null;
        }
        if (this.currentUser) {
            this.updateAvatar();
            this.navigate('home');
        } else {
            this.navigate('auth');
        }
        
        // Initialize carousel visuals
        setTimeout(() => this.updateCarouselVisuals(), 100);
    }
    
    updateAvatar() {
        if (!this.currentUser) return;
        
        const name = this.currentUser.name || this.currentUser.email || "Zen User";
        const letters = name.substring(0, 2).toUpperCase();
        
        const avatarImg = document.getElementById('avatar-img');
        if (avatarImg) {
            avatarImg.src = `https://ui-avatars.com/api/?name=${letters}&background=ffd3b6&color=333&length=2`;
        }
        
        const dropdownName = document.getElementById('dropdown-name');
        if (dropdownName) {
            dropdownName.innerText = name;
        }
    }

    toggleDropdown() {
        const dropdown = document.getElementById('avatar-dropdown');
        if (dropdown) {
            if (dropdown.style.display === 'none') {
                dropdown.style.display = 'block';
            } else {
                dropdown.style.display = 'none';
            }
        }
    }

    navigate(viewName) {
        // Remove active class from all views
        Object.values(this.views).forEach(v => {
            if(v) v.classList.remove('active');
        });
        
        // Add active class to target view after slight delay for transitions
        if(this.views[viewName]) {
            setTimeout(() => this.views[viewName].classList.add('active'), 10);
        }
        
        this.currentView = viewName;
        
        if (viewName === 'auth') {
            this.topNav.style.display = 'none';
        } else {
            this.topNav.style.display = 'flex';
        }

        // Update top nav cancel button visibility
        if (viewName === 'home' || viewName === 'auth') {
            this.actionCancel.style.display = 'none';
        } else {
            this.actionCancel.style.display = 'inline-block';
        }
        
        // Handle specific view logistics
        if (viewName === 'gallery') this.renderGallery();
        if (viewName === 'recorder') this.resetRecorder();
    }
    
    /* --- CAROUSEL LOGIC --- */
    updateCarouselVisuals() {
        const spaces = document.querySelectorAll('.space-card');
        if (!spaces.length) return;
        
        spaces.forEach((space, i) => {
            space.classList.remove('active', 'prev-card', 'next-card');
            
            if (i === this.currentSpaceIndex) {
                space.classList.add('active');
            } else if (i === (this.currentSpaceIndex - 1 + spaces.length) % spaces.length) {
                space.classList.add('prev-card');
            } else if (i === (this.currentSpaceIndex + 1) % spaces.length) {
                space.classList.add('next-card');
            }
        });
        
        const dots = document.querySelectorAll('.dots .dot');
        dots.forEach((dot, index) => {
            if (index === this.currentSpaceIndex) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    nextSpace() {
        const spaces = document.querySelectorAll('.space-card');
        if (!spaces.length) return;
        this.currentSpaceIndex = (this.currentSpaceIndex + 1) % spaces.length;
        this.updateCarouselVisuals();
    }

    prevSpace() {
        const spaces = document.querySelectorAll('.space-card');
        if (!spaces.length) return;
        this.currentSpaceIndex = (this.currentSpaceIndex - 1 + spaces.length) % spaces.length;
        this.updateCarouselVisuals();
    }

    /* --- RECORDER LOGIC --- */
    toggleRecording() {
        if (this.isRecording) {
            this.finishRecording();
        } else {
            this.startRecording();
        }
    }
    
    async startRecording() {
        this.isRecording = true;
        this.recordingSeconds = 0;
        this.audioChunks = [];
        this.transcription = "";
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };
            
            this.mediaRecorder.start();

            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRec) {
                this.speechRecognition = new SpeechRec();
                this.speechRecognition.continuous = true;
                this.speechRecognition.interimResults = true;
                this.speechRecognition.onresult = (event) => {
                    let finalTranscript = "";
                    let interimTranscript = "";
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript += event.results[i][0].transcript;
                        } else {
                            interimTranscript += event.results[i][0].transcript;
                        }
                    }
                    this.transcription += finalTranscript;
                    let displayTxt = this.transcription + interimTranscript;
                    if (displayTxt.trim().length > 0) {
                        this.recordPrompt.innerText = displayTxt;
                    }
                };
                this.speechRecognition.start();
            }
        } catch(err) {
            console.error(err);
            this.recordPrompt.innerText = "Mic access denied";
            this.isRecording = false;
            return;
        }

        // UI Updates
        this.micBtn.style.transform = 'scale(0.9)';
        this.micBtn.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.4), rgba(153, 27, 27, 0.2))';
        this.micBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        this.micBtn.style.boxShadow = '0 0 50px rgba(239, 68, 68, 0.3)';
        
        this.recordPrompt.innerText = "Describe your dream...";
        this.recordStatus.style.opacity = '1';
        this.audioWaves.classList.add('active');
        
        // Timer
        this.recordingTimer = setInterval(() => {
            this.recordingSeconds++;
            this.updateRecordingTime();
            
            if(this.recordingSeconds >= 600) this.finishRecording();
        }, 1000);
    }
    
    updateRecordingTime() {
        const mins = Math.floor(this.recordingSeconds / 60).toString().padStart(2, '0');
        const secs = (this.recordingSeconds % 60).toString().padStart(2, '0');
        this.recTime.innerText = `${mins}:${secs}`;
        
        const percentage = (this.recordingSeconds / 600) * 100;
        this.recFill.style.width = `${percentage}%`;
    }
    
    finishRecording() {
        this.stopRecordingTimer();

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            // Stop tracks
            this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
        if (this.speechRecognition) {
            this.speechRecognition.stop();
        }
        
        // If recording was too short, cancel
        if (this.recordingSeconds < 2) {
            this.resetRecorder();
            return;
        }

        // Show generating modal early to cover up saving delay
        this.modal.classList.add('active');
        
        // Wait a tiny bit for the last mediaRecorder chunk to parse
        setTimeout(() => {
            setTimeout(async () => {
                await this.saveMockDream();
                this.modal.classList.remove('active');
                this.navigate('gallery');
            }, 3000); // 3 seconds fake generation
        }, 300);
    }
    
    stopRecordingTimer() {
        this.isRecording = false;
        clearInterval(this.recordingTimer);
    }
    
    resetRecorder() {
        this.stopRecordingTimer();
        this.recordingSeconds = 0;
        this.updateRecordingTime();
        
        // UI Reset
        this.micBtn.style.transform = 'scale(1)';
        this.micBtn.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(76, 29, 149, 0.2))';
        this.micBtn.style.borderColor = 'rgba(139, 92, 246, 0.5)';
        this.micBtn.style.boxShadow = '0 0 50px rgba(139, 92, 246, 0.3)';
        
        this.recordPrompt.innerText = "Whisper your dream...";
        this.recordStatus.style.opacity = '0';
        this.audioWaves.classList.remove('active');
        this.recFill.style.width = '0%';
    }
    
    /* --- GALLERY LOGIC --- */
    async saveMockDream() {
        const randomImage = this.mockGeneratedImages[Math.floor(Math.random() * this.mockGeneratedImages.length)];
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        
        const dreams = await DB.getAll();
        const newDream = {
            id: Date.now(),
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            duration: this.recTime.innerText,
            imageUrl: randomImage,
            title: `Dream Log #${dreams.length + 1}`,
            audioBlob: audioBlob,
            transcription: this.transcription || "No transcription recorded."
        };
        
        await DB.add(newDream);
        this.resetRecorder();
    }
    
    async renderGallery() {
        const listContainer = document.getElementById('dream-gallery-list');
        const emptyState = document.getElementById('gallery-empty');
        
        listContainer.innerHTML = '';
        const dreams = await DB.getAll();
        
        if (dreams.length === 0) {
            listContainer.style.display = 'none';
            emptyState.style.display = 'flex';
            return;
        }
        
        listContainer.style.display = 'grid';
        emptyState.style.display = 'none';
        
        dreams.forEach(dream => {
            const card = document.createElement('div');
            card.className = 'dream-card fade-in';
            
            let audioUrl = '';
            if(dream.audioBlob && dream.audioBlob.size > 0) {
                audioUrl = URL.createObjectURL(dream.audioBlob);
            }

            card.innerHTML = `
                <img src="${dream.imageUrl}" alt="Dream Visual" class="dream-image">
                <div class="dream-info">
                    <div class="dream-date">${dream.date} • ${dream.duration}</div>
                    <div class="dream-title">${dream.title}</div>
                    <p class="dream-transcription">${dream.transcription}</p>
                    ${audioUrl ? `<audio class="dream-audio" controls src="${audioUrl}"></audio>` : ''}
                </div>
            `;
            listContainer.appendChild(card);
        });
    }

    /* --- AUTHENTICATION LOGIC --- */
    switchAuth(type) {
        if (type === 'login') {
            document.getElementById('login-box').style.display = 'block';
            document.getElementById('register-box').style.display = 'none';
        } else {
            document.getElementById('login-box').style.display = 'none';
            document.getElementById('register-box').style.display = 'block';
        }
    }

    async register() {
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        
        try {
            const user = { name, email, password };
            await DB.addUser(user);
            this.currentUser = user;
            localStorage.setItem('zen_user', JSON.stringify(user));
            this.updateAvatar();
            this.navigate('home');
        } catch (e) {
            alert('Error registering! User might already exist.');
        }
    }

    async login() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        try {
            const user = await DB.getUser(email);
            if (user && user.password === password) {
                this.currentUser = user;
                localStorage.setItem('zen_user', JSON.stringify(user));
                this.updateAvatar();
                this.navigate('home');
            } else {
                alert('Invalid email or password.');
            }
        } catch (e) {
            alert('Error logging in.');
        }
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('zen_user');
        
        // Hide dropdown
        const dropdown = document.getElementById('avatar-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        
        // Clear all input fields
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('reg-name').value = '';
        document.getElementById('reg-email').value = '';
        document.getElementById('reg-password').value = '';
        
        this.switchAuth('login'); // Default back to the login view
        this.navigate('auth');
    }
}

// Initialize application
const app = new ZenApp();
