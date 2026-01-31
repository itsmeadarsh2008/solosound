// js/social.js - Social features for friends, activity, and collaborative playlists
import { syncManager } from './accounts/sync.js';
import { authManager } from './accounts/auth.js';

const socialManager = {
    _friends: [],
    _pendingRequests: [],
    _activityFeed: [],
    _trackSuggestions: [],
    _sharedPlaylists: [],
    _friendActivity: [],

    // Initialize social features
    async init() {
        // Initialize friend code system (works independently of sync)
        this._initFriendCodeSystem();

        // Wait for authentication before loading full social data
        authManager.onAuthStateChange(async (user) => {
            if (user) {
                // Sync any pending friends from local storage
                await this._syncPendingFriends();
                
                // User is authenticated, load additional social data
                await this._loadFriendsData();
                await this._loadActivityData();

                // Set up periodic updates
                setInterval(() => {
                    this._loadActivityData();
                }, 30000); // Update every 30 seconds

                // Listen for track changes to update activity
                window.addEventListener('track-changed', (e) => {
                    if (e.detail?.track) {
                        this.updateCurrentActivity(e.detail.track, true);
                    }
                });

                window.addEventListener('playback-paused', () => {
                    this.updateCurrentActivity(null, false);
                });
            } else {
                // User not authenticated, clear server-dependent UI
                this._friends = [];
                this._pendingRequests = [];
                this._activityFeed = [];
                this._updateFriendsUI();
                this._updateActivityUI();
            }
        });
    },

    // Initialize the friend code system (works locally)
    _initFriendCodeSystem() {
        // Generate or load friend code immediately
        const friendCode = this._getOrCreateFriendCode();
        this._updateFriendCodeUI(friendCode);

        // Set up friend code regeneration
        const regenerateBtn = document.getElementById('regenerate-code-btn');
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', async () => {
                const newCode = await this._regenerateFriendCode();
                this._updateFriendCodeUI(newCode);
            });
        }

        // Set up add friend functionality
        const addFriendBtn = document.getElementById('add-friend-btn');
        const friendCodeInput = document.getElementById('friend-code-input');
        if (addFriendBtn && friendCodeInput) {
            addFriendBtn.addEventListener('click', async () => {
                const code = friendCodeInput.value.trim().toUpperCase();
                if (code) {
                    await this.addFriend(code);
                    friendCodeInput.value = '';
                }
            });
        }
    },

    // Get or create a friend code (local storage based)
    _getOrCreateFriendCode() {
        let friendCode = localStorage.getItem('friend_code');

        if (!friendCode) {
            // Generate a new 6-character code
            friendCode = this._generateFriendCode();
            localStorage.setItem('friend_code', friendCode);
        }

        return friendCode;
    },

    // Generate a random 6-character friend code
    _generateFriendCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    // Regenerate friend code
    async _regenerateFriendCode() {
        const newCode = this._generateFriendCode();
        localStorage.setItem('friend_code', newCode);

        // If authenticated, also update in sync
        if (authManager.isAuthenticated()) {
            try {
                await syncManager.generateFriendCode();
            } catch (error) {
                console.warn('Failed to sync new friend code:', error);
            }
        }

        return newCode;
    },

    // Load friend code (only called when authenticated)
    async _loadFriendCode() {
        // This method is now handled by _initFriendCodeSystem
        // Keeping for backwards compatibility with sync system
        return this._getOrCreateFriendCode();
    },

    // Load friends-related data
    async _loadFriendsData() {
        if (!authManager.isAuthenticated()) return;

        this._friends = await syncManager.getFriends();
        this._pendingRequests = await syncManager.getPendingFriendRequests();
        this._trackSuggestions = await syncManager.getTrackSuggestions();
        this._sharedPlaylists = await syncManager.getSharedPlaylists();

        this._updateFriendsUI();
    },

    async _syncPendingFriends() {
        const pendingFriends = JSON.parse(localStorage.getItem('pending_friends') || '[]');
        if (pendingFriends.length === 0) return;

        for (const friendCode of pendingFriends) {
            try {
                const success = await syncManager.addFriendByCode(friendCode);
                if (success) {
                    // Successfully synced
                } else {
                    console.warn('Failed to sync friend:', friendCode);
                }
            } catch (error) {
                console.error('Error syncing friend:', friendCode, error);
            }
        }

        // Clear pending friends after sync attempt
        localStorage.removeItem('pending_friends');
    },

    // Load activity-related data
    async _loadActivityData() {
        if (!authManager.isAuthenticated()) return;

        this._activityFeed = await syncManager.getActivityFeed();
        this._friendActivity = await syncManager.getFriendsActivity();

        this._updateActivityUI();
    },
    async updateCurrentActivity(track, isPlaying) {
        if (track) {
            await syncManager.updateActivity(track, isPlaying);
        } else {
            // Clear activity when stopped
            const userId = syncManager._getUserId();
            if (syncManager.client) {
                await syncManager.client.execute({
                    sql: `DELETE FROM user_activity WHERE user_id = ?`,
                    args: [userId],
                });
            }
        }
    },

    // Add friend by code
    async addFriend(friendCode) {
        const code = friendCode.toUpperCase();

        // Validate friend code format
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            this._showNotification('Invalid friend code format', 'error');
            return;
        }

        // Don't allow adding your own code
        const myCode = this._getOrCreateFriendCode();
        if (code === myCode) {
            this._showNotification('You cannot add yourself as a friend', 'error');
            return;
        }

        // If authenticated, use sync system
        if (authManager.isAuthenticated()) {
            const success = await syncManager.addFriendByCode(code);
            if (success) {
                await this._loadFriendsData();
                this._showNotification('Friend request sent!', 'success');
            } else {
                this._showNotification('Invalid friend code or already friends', 'error');
            }
        } else {
            // Store locally for later sync
            const pendingFriends = JSON.parse(localStorage.getItem('pending_friends') || '[]');
            if (!pendingFriends.includes(code)) {
                pendingFriends.push(code);
                localStorage.setItem('pending_friends', JSON.stringify(pendingFriends));
                this._showNotification('Friend code saved! Sign in to sync friends.', 'info');
            } else {
                this._showNotification('Friend code already saved', 'info');
            }
        }
    },

    // Accept friend request
    async acceptFriendRequest(friendUserId) {
        await syncManager.acceptFriendRequest(friendUserId);
        await this._loadFriendsData();
        this._showNotification('Friend request accepted!', 'success');
    },

    // Generate new friend code
    async regenerateFriendCode() {
        const newCode = await this._regenerateFriendCode();
        this._updateFriendCodeUI(newCode);
        this._showNotification('New friend code generated!', 'success');
    },

    // Suggest track to friend
    async suggestTrack(friendUserId, track, message = '') {
        await syncManager.suggestTrackToFriend(friendUserId, track, message);
        this._showNotification('Track suggestion sent!', 'success');
    },

    // Update suggestion status
    async updateSuggestionStatus(suggestionId, status) {
        await syncManager.updateSuggestionStatus(suggestionId, status);
        await this._loadFriendsData();
    },

    // Share playlist
    async sharePlaylist(playlistId, friendUserId, permission = 'view') {
        await syncManager.sharePlaylistWithFriend(playlistId, friendUserId, permission);
        this._showNotification('Playlist shared!', 'success');
    },

    // Create collaborative playlist
    async createCollaborativePlaylist(name, description = '') {
        const playlistData = {
            name,
            description,
            tracks: [],
            created: Date.now(),
            collaborative: true,
        };

        const playlistId = await syncManager.createCollaborativePlaylist(playlistData);
        this._showNotification('Collaborative playlist created!', 'success');
        return playlistId;
    },

    // Sync collaborative change
    async syncCollaborativeChange(playlistId, changeType, changeData) {
        await syncManager.syncCollaborativeChange(playlistId, changeType, changeData);
    },

    // Get collaborative changes
    async getCollaborativeChanges(playlistId, since = 0) {
        return await syncManager.getCollaborativeChanges(playlistId, since);
    },

    // UI Update methods
    _updateFriendsUI() {
        // Update friends list
        const friendsList = document.getElementById('friends-list');
        if (friendsList) {
            if (this._friends.length === 0) {
                friendsList.innerHTML = '<div class="empty-state">No friends yet. Add some friends to get started!</div>';
            } else {
                friendsList.innerHTML = this._friends.map(friend => `
                    <div class="friend-item">
                        <div class="friend-info">
                            <span class="friend-code">${friend.friend_code}</span>
                            <span class="friend-status">Friends since ${new Date(friend.accepted_at).toLocaleDateString()}</span>
                        </div>
                        <div class="friend-actions">
                            <button onclick="socialManager.suggestTrack('${friend.friend_user_id}', player.currentTrack, 'Check this out!')">
                                Suggest Track
                            </button>
                            <button onclick="socialManager.sharePlaylist(player.currentPlaylist?.id, '${friend.friend_user_id}')">
                                Share Playlist
                            </button>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Update pending requests
        const pendingList = document.getElementById('pending-requests');
        if (pendingList) {
            if (this._pendingRequests.length === 0) {
                pendingList.innerHTML = '<div class="empty-state">No friend requests yet.</div>';
            } else {
                pendingList.innerHTML = this._pendingRequests.map(request => `
                    <div class="pending-request">
                        <span>Friend request from ${request.friend_code}</span>
                        <button onclick="socialManager.acceptFriendRequest('${request.user_id}')">Accept</button>
                    </div>
                `).join('');
            }
        }

        // Update suggestions
        const suggestionsList = document.getElementById('track-suggestions');
        if (suggestionsList) {
            if (this._trackSuggestions.length === 0) {
                suggestionsList.innerHTML = '<div class="empty-state">No track suggestions yet.</div>';
            } else {
                suggestionsList.innerHTML = this._trackSuggestions.map(suggestion => `
                    <div class="suggestion-item ${suggestion.status}">
                        <div class="suggestion-info">
                            <span class="from-friend">${suggestion.friend_code} suggested:</span>
                            <span class="track-title">${suggestion.track_data.title}</span>
                            ${suggestion.message ? `<span class="suggestion-message">${suggestion.message}</span>` : ''}
                        </div>
                        ${suggestion.status === 'pending' ? `
                            <div class="suggestion-actions">
                                <button onclick="socialManager.updateSuggestionStatus(${suggestion.id}, 'accepted')">Accept</button>
                                <button onclick="socialManager.updateSuggestionStatus(${suggestion.id}, 'declined')">Decline</button>
                            </div>
                        ` : `<span class="suggestion-status">${suggestion.status}</span>`}
                    </div>
                `).join('');
            }
        }

        // Update shared playlists
        const sharedPlaylists = document.getElementById('shared-playlists');
        if (sharedPlaylists) {
            if (this._sharedPlaylists.length === 0) {
                sharedPlaylists.innerHTML = '<div class="empty-state">No shared playlists yet.</div>';
            } else {
                sharedPlaylists.innerHTML = this._sharedPlaylists.map(playlist => `
                    <div class="shared-playlist-item">
                        <span class="playlist-name">${playlist.playlist_data.name}</span>
                        <span class="shared-by">Shared by ${playlist.friend_code}</span>
                    </div>
                `).join('');
            }
        }
    },

    _updateActivityUI() {
        // Update activity feed
        const activityFeed = document.getElementById('activity-feed');
        if (activityFeed) {
            if (this._activityFeed.length === 0) {
                activityFeed.innerHTML = '<div class="empty-state">No activity yet.</div>';
            } else {
                activityFeed.innerHTML = this._activityFeed.map(activity => `
                    <div class="activity-item">
                        <span class="activity-friend">${activity.friend_code}</span>
                        <span class="activity-type">${this._formatActivityType(activity.activity_type)}</span>
                        <span class="activity-data">${this._formatActivityData(activity)}</span>
                        <span class="activity-time">${this._formatTime(activity.created_at)}</span>
                    </div>
                `).join('');
            }
        }

    // Update friends activity
        const friendsActivity = document.getElementById('friends-activity');
        if (friendsActivity) {
            if (this._friendActivity.length === 0) {
                friendsActivity.innerHTML = '<div class="empty-state">No friends activity yet.</div>';
            } else {
                friendsActivity.innerHTML = this._friendActivity.map(activity => `
                    <div class="friend-activity-item">
                        <div class="activity-info">
                            <span class="friend-code">${activity.friend_code}</span>
                            <span class="activity-status">${activity.is_playing ? 'is listening to' : 'last listened to'}</span>
                            <span class="track-title">${activity.track_data.title}</span>
                            ${activity.is_playing ? `<span class="progress">${Math.floor(activity.progress_seconds / 60)}:${(activity.progress_seconds % 60).toString().padStart(2, '0')}</span>` : ''}
                        </div>
                        <button onclick="player.loadTrack(${JSON.stringify(activity.track_data).replace(/"/g, '&quot;')})">
                            Listen
                        </button>
                    </div>
                `).join('');
            }
        }

        // Update homepage friend activity
        this._updateHomepageFriendActivity();
    },

    // Update homepage friend activity section
    _updateHomepageFriendActivity() {
        const homeSection = document.getElementById('friends-activity-section');
        const homeActivity = document.getElementById('home-friends-activity');

        if (!homeSection || !homeActivity) return;

        // Only show if authenticated and has activity
        if (!authManager.isAuthenticated() || this._friendActivity.length === 0) {
            homeSection.style.display = 'none';
            return;
        }

        homeSection.style.display = 'block';

        // Show only the first 3 activities for homepage
        const recentActivity = this._friendActivity.slice(0, 3);
        homeActivity.innerHTML = recentActivity.map(activity => `
            <div class="friend-activity-item">
                <div class="activity-info">
                    <span class="friend-code">${activity.friend_code}</span>
                    <span class="activity-status">${activity.is_playing ? 'is listening to' : 'last listened to'}</span>
                    <span class="track-title">${activity.track_data.title}</span>
                    ${activity.is_playing ? `<span class="progress">${Math.floor(activity.progress_seconds / 60)}:${(activity.progress_seconds % 60).toString().padStart(2, '0')}</span>` : ''}
                </div>
                <button onclick="player.loadTrack(${JSON.stringify(activity.track_data).replace(/"/g, '&quot;')})">
                    Listen
                </button>
            </div>
        `).join('');
    },

    _updateFriendCodeUI(code) {
        const codeDisplay = document.getElementById('friend-code-display');
        if (codeDisplay) {
            if (code && code.length === 6) {
                // Valid friend code
                codeDisplay.textContent = code;
                codeDisplay.style.color = 'var(--text-primary)';
            } else if (code === 'Not authenticated') {
                codeDisplay.textContent = 'Sign in to sync friends';
                codeDisplay.style.color = 'var(--text-secondary)';
            } else {
                codeDisplay.textContent = code || 'Loading...';
                codeDisplay.style.color = 'var(--text-secondary)';
            }
        }
    },

    // Helper methods
    _formatActivityType(type) {
        const types = {
            'started_track': 'started listening to',
            'liked_track': 'liked',
            'created_playlist': 'created playlist',
            'shared_playlist': 'shared playlist',
        };
        return types[type] || type;
    },

    _formatActivityData(activity) {
        if (activity.activity_type === 'started_track' || activity.activity_type === 'liked_track') {
            return activity.activity_data.title;
        }
        return activity.activity_data.name || 'something';
    },

    _formatTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    },

    _showNotification(message, type = 'info') {
        // Simple notification system
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    socialManager.init();

    // Friends page event listeners
    const addFriendBtn = document.getElementById('add-friend-btn');
    const friendCodeInput = document.getElementById('friend-code-input');
    const regenerateCodeBtn = document.getElementById('regenerate-code-btn');

    if (addFriendBtn) {
        addFriendBtn.addEventListener('click', async () => {
            const code = friendCodeInput.value.trim();
            if (code) {
                await socialManager.addFriend(code);
                friendCodeInput.value = '';
            }
        });
    }

    if (friendCodeInput) {
        friendCodeInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const code = friendCodeInput.value.trim();
                if (code) {
                    await socialManager.addFriend(code);
                    friendCodeInput.value = '';
                }
            }
        });
    }

    if (regenerateCodeBtn) {
        regenerateCodeBtn.addEventListener('click', async () => {
            await socialManager.regenerateFriendCode();
        });
    }

    // Load friend code on page show
    const friendsPage = document.getElementById('page-friends');
    if (friendsPage) {
        const observer = new MutationObserver(async (mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const display = window.getComputedStyle(friendsPage).display;
                    if (display !== 'none') {
                        // Page is now visible, load friend code and friends data
                        socialManager._loadFriendCode();
                        if (syncManager._canSync()) {
                            socialManager._loadFriendsData();
                        }
                    }
                }
            });
        });
        observer.observe(friendsPage, { attributes: true, attributeFilter: ['style'] });
    }
});

// Make socialManager globally available
window.socialManager = socialManager;

export { socialManager };