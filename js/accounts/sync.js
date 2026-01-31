// js/accounts/sync.js - Instant sync with Turso for seed-based authentication
import { createClient } from "@libsql/client";
import { authManager } from './auth.js';

const tursoUrl = localStorage.getItem('monochrome-turso-url');
const tursoToken = localStorage.getItem('monochrome-turso-token');

const client = tursoUrl && tursoUrl !== 'your-turso-url' ? createClient({
    url: tursoUrl,
    authToken: tursoToken || undefined,
}) : null;

const syncManager = {
    client: client,
    _isOnline: false,
    _syncQueue: [],
    _isProcessingQueue: false,

    // Initialize sync manager
    init() {
        this._isOnline = !!this.client;
        if (this._isOnline) {
            this._startPeriodicSync();
        }
    },

    // Check if user is authenticated and online
    _canSync() {
        return this._isOnline && authManager.isAuthenticated();
    },

    // Get current user ID
    _getUserId() {
        return authManager.user?.id;
    },

    // Start periodic sync for any queued changes
    _startPeriodicSync() {
        setInterval(() => {
            if (this._canSync() && this._syncQueue.length > 0) {
                this._processSyncQueue();
            }
        }, 1000); // Sync every second
    },

    // Add operation to sync queue
    _queueSync(operation) {
        this._syncQueue.push(operation);
        if (this._canSync() && !this._isProcessingQueue) {
            this._processSyncQueue();
        }
    },

    // Process queued sync operations
    async _processSyncQueue() {
        if (this._isProcessingQueue || !this._canSync()) return;

        this._isProcessingQueue = true;

        while (this._syncQueue.length > 0) {
            const operation = this._syncQueue.shift();
            try {
                await operation();
            } catch (error) {
                console.error('Sync operation failed:', error);
                // Re-queue failed operations with exponential backoff
                setTimeout(() => {
                    this._syncQueue.unshift(operation);
                }, 5000);
                break;
            }
        }

        this._isProcessingQueue = false;
    },

    // Ensure user exists in database
    async _ensureUserExists() {
        if (!this._canSync()) return;

        const userId = this._getUserId();
        const seedHash = CryptoJS.SHA256(authManager.getSeed()).toString();

        try {
            await this.client.execute({
                sql: `INSERT OR IGNORE INTO users (user_id, seed_hash, created_at, last_sync)
                      VALUES (?, ?, ?, ?)`,
                args: [userId, seedHash, Date.now(), Date.now()],
            });
        } catch (error) {
            console.error('Failed to ensure user exists:', error);
        }
    },

    // Sync favorite track
    async syncFavoriteTrack(track, added) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (added) {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_favorite_tracks
                          (user_id, track_id, track_data, added_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, track.id.toString(), JSON.stringify(track), Date.now(), Date.now()],
                });
            } else {
                await this.client.execute({
                    sql: `DELETE FROM user_favorite_tracks WHERE user_id = ? AND track_id = ?`,
                    args: [userId, track.id.toString()],
                });
            }
        });
    },

    // Sync favorite album
    async syncFavoriteAlbum(album, added) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (added) {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_favorite_albums
                          (user_id, album_id, album_data, added_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, album.id.toString(), JSON.stringify(album), Date.now(), Date.now()],
                });
            } else {
                await this.client.execute({
                    sql: `DELETE FROM user_favorite_albums WHERE user_id = ? AND album_id = ?`,
                    args: [userId, album.id.toString()],
                });
            }
        });
    },

    // Sync favorite artist
    async syncFavoriteArtist(artist, added) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (added) {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_favorite_artists
                          (user_id, artist_id, artist_data, added_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, artist.id.toString(), JSON.stringify(artist), Date.now(), Date.now()],
                });
            } else {
                await this.client.execute({
                    sql: `DELETE FROM user_favorite_artists WHERE user_id = ? AND artist_id = ?`,
                    args: [userId, artist.id.toString()],
                });
            }
        });
    },

    // Sync favorite playlist
    async syncFavoritePlaylist(playlist, added) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (added) {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_favorite_playlists
                          (user_id, playlist_id, playlist_data, added_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, playlist.uuid, JSON.stringify(playlist), Date.now(), Date.now()],
                });
            } else {
                await this.client.execute({
                    sql: `DELETE FROM user_favorite_playlists WHERE user_id = ? AND playlist_id = ?`,
                    args: [userId, playlist.uuid],
                });
            }
        });
    },

    // Sync favorite mix
    async syncFavoriteMix(mix, added) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (added) {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_favorite_mixes
                          (user_id, mix_id, mix_data, added_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, mix.id.toString(), JSON.stringify(mix), Date.now(), Date.now()],
                });
            } else {
                await this.client.execute({
                    sql: `DELETE FROM user_favorite_mixes WHERE user_id = ? AND mix_id = ?`,
                    args: [userId, mix.id.toString()],
                });
            }
        });
    },

    // Sync user playlist
    async syncUserPlaylist(playlist, action = 'update') {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (action === 'delete') {
                await this.client.execute({
                    sql: `DELETE FROM user_playlists WHERE user_id = ? AND playlist_id = ?`,
                    args: [userId, playlist.id],
                });
            } else {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_playlists
                          (user_id, playlist_id, playlist_data, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, playlist.id, JSON.stringify(playlist), Date.now(), Date.now()],
                });
            }
        });
    },

    // Sync playlist folder
    async syncUserFolder(folder, action = 'update') {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            if (action === 'delete') {
                await this.client.execute({
                    sql: `DELETE FROM user_playlist_folders WHERE user_id = ? AND folder_id = ?`,
                    args: [userId, folder.id],
                });
            } else {
                await this.client.execute({
                    sql: `INSERT OR REPLACE INTO user_playlist_folders
                          (user_id, folder_id, folder_data, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?)`,
                    args: [userId, folder.id, JSON.stringify(folder), Date.now(), Date.now()],
                });
            }
        });
    },

    // Sync play history
    async syncHistoryItem(track) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();
        const playedAt = Date.now();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT OR REPLACE INTO user_history
                      (user_id, track_id, track_data, played_at)
                      VALUES (?, ?, ?, ?)`,
                args: [userId, track.id.toString(), JSON.stringify(track), playedAt],
            });

            // Keep only last 1000 history items per user
            await this.client.execute({
                sql: `DELETE FROM user_history
                      WHERE user_id = ? AND id NOT IN (
                          SELECT id FROM user_history
                          WHERE user_id = ?
                          ORDER BY played_at DESC
                          LIMIT 1000
                      )`,
                args: [userId, userId],
            });
        });
    },

    // Sync user settings
    async syncSettings(settings) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT OR REPLACE INTO user_settings
                      (user_id, settings_data, updated_at)
                      VALUES (?, ?, ?)`,
                args: [userId, JSON.stringify(settings), Date.now()],
            });
        });
    },

    // Collect all current settings for sync
    async collectAndSyncAllSettings() {
        if (!this._canSync()) return;

        // Import all settings modules
        const {
            themeManager,
            lastFMStorage,
            nowPlayingSettings,
            lyricsSettings,
            backgroundSettings,
            trackListSettings,
            cardSettings,
            waveformSettings,
            replayGainSettings,
            smoothScrollingSettings,
            downloadQualitySettings,
            coverArtSizeSettings,
            qualityBadgeSettings,
            visualizerSettings,
            bulkDownloadSettings,
        } = await import('../storage.js');

        const allSettings = {
            theme: themeManager.getCurrentTheme(),
            lastFM: {
                enabled: lastFMStorage.isEnabled(),
                loveOnLike: lastFMStorage.shouldLoveOnLike(),
                sessionKey: lastFMStorage.getSessionKey(),
            },
            nowPlaying: nowPlayingSettings.getMode(),
            lyrics: {
                romajiMode: lyricsSettings.isRomajiModeEnabled(),
            },
            background: backgroundSettings.getSettings(),
            trackList: trackListSettings.getSettings(),
            cards: cardSettings.getSettings(),
            waveform: waveformSettings.getSettings(),
            replayGain: replayGainSettings.getSettings(),
            smoothScrolling: smoothScrollingSettings.getSettings(),
            downloadQuality: downloadQualitySettings.getQuality(),
            coverArtSize: coverArtSizeSettings.getSize(),
            qualityBadge: qualityBadgeSettings.getSettings(),
            visualizer: visualizerSettings.getSettings(),
            bulkDownload: bulkDownloadSettings.getSettings(),
            // Add other app settings
            elegantMode: localStorage.getItem('elegant-mode') === 'true',
            globalBorderRadius: localStorage.getItem('global-border-radius') || '8',
            showTrackDurations: localStorage.getItem('show-track-durations') === 'true',
            playbackQuality: localStorage.getItem('playback-quality') || 'LOSSLESS',
            libraryView: localStorage.getItem('libraryView') || 'grid',
            volume: localStorage.getItem('volume') || '0.7',
        };

        await this.syncSettings(allSettings);
    },

    // Save album art
    async saveAlbumArt(albumId, url, data = null) {
        if (!this._canSync()) return;

        await this._ensureUserExists();
        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT OR REPLACE INTO album_art
                      (user_id, album_id, url, data, cached_at)
                      VALUES (?, ?, ?, ?, ?)`,
                args: [userId, albumId.toString(), url, data, Date.now()],
            });
        });
    },

    // Get album art
    async getAlbumArt(albumId) {
        if (!this._canSync()) return null;

        const userId = this._getUserId();
        try {
            const result = await this.client.execute({
                sql: "SELECT url, data FROM album_art WHERE user_id = ? AND album_id = ?",
                args: [userId, albumId.toString()],
            });
            if (result.rows.length > 0) {
                return result.rows[0];
            }
        } catch (error) {
            console.error('Failed to get album art:', error);
        }
        return null;
    },

    // Fetch all user data from cloud (for initial sync)
    async fetchUserData() {
        if (!this._canSync()) return null;

        const userId = this._getUserId();

        try {
            const [tracks, albums, artists, playlists, mixes, userPlaylists, folders, history, settings] = await Promise.all([
                this.client.execute({
                    sql: "SELECT track_data FROM user_favorite_tracks WHERE user_id = ? ORDER BY added_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT album_data FROM user_favorite_albums WHERE user_id = ? ORDER BY added_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT artist_data FROM user_favorite_artists WHERE user_id = ? ORDER BY added_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT playlist_data FROM user_favorite_playlists WHERE user_id = ? ORDER BY added_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT mix_data FROM user_favorite_mixes WHERE user_id = ? ORDER BY added_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT playlist_data FROM user_playlists WHERE user_id = ? ORDER BY updated_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT folder_data FROM user_playlist_folders WHERE user_id = ? ORDER BY updated_at DESC",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT track_data FROM user_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 100",
                    args: [userId],
                }),
                this.client.execute({
                    sql: "SELECT settings_data FROM user_settings WHERE user_id = ?",
                    args: [userId],
                }),
            ]);

            return {
                favorites_tracks: tracks.rows.map(r => JSON.parse(r.track_data)),
                favorites_albums: albums.rows.map(r => JSON.parse(r.album_data)),
                favorites_artists: artists.rows.map(r => JSON.parse(r.artist_data)),
                favorites_playlists: playlists.rows.map(r => JSON.parse(r.playlist_data)),
                favorites_mixes: mixes.rows.map(r => JSON.parse(r.mix_data)),
                user_playlists: userPlaylists.rows.map(r => JSON.parse(r.playlist_data)),
                user_folders: folders.rows.map(r => JSON.parse(r.folder_data)),
                history_tracks: history.rows.map(r => JSON.parse(r.track_data)),
                settings: settings.rows.length > 0 ? JSON.parse(settings.rows[0].settings_data) : {},
            };
        } catch (error) {
            console.error('Failed to fetch user data:', error);
            return null;
        }
    },

    // Clear all cloud data for user
    async clearCloudData() {
        if (!this._canSync()) return;

        const userId = this._getUserId();

        try {
            await Promise.all([
                this.client.execute({ sql: "DELETE FROM user_favorite_tracks WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_favorite_albums WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_favorite_artists WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_favorite_playlists WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_favorite_mixes WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_playlists WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_playlist_folders WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_history WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM album_art WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM user_settings WHERE user_id = ?", args: [userId] }),
                this.client.execute({ sql: "DELETE FROM users WHERE user_id = ?", args: [userId] }),
            ]);
        } catch (error) {
            console.error('Failed to clear cloud data:', error);
            throw error;
        }
    },

    // Handle authentication state changes
    async onAuthStateChanged(user) {
        if (user) {
            this.init();

            if (this._canSync()) {
                try {
                    const cloudData = await this.fetchUserData();
                    if (cloudData) {
                        const { db } = await import('../db.js');
                        await db.importData(cloudData, true); // Clear local and import cloud data
                        await new Promise(resolve => setTimeout(resolve, 300));

                        // Apply synced settings
                        if (cloudData.settings) {
                            await this._applySyncedSettings(cloudData.settings);
                        }

                        window.dispatchEvent(new CustomEvent('library-changed'));
                        window.dispatchEvent(new CustomEvent('history-changed'));
                        window.dispatchEvent(new HashChangeEvent('hashchange'));
                    }
                } catch (error) {
                    console.error('Error during initial sync:', error);
                }
            }
        } else {
            this._isOnline = false;
            this._syncQueue = [];
            this._isProcessingQueue = false;
        }
    },

    // Apply synced settings to local storage
    async _applySyncedSettings(settings) {
        try {
            // Apply settings to localStorage and storage modules
            if (settings.theme) localStorage.setItem('theme', settings.theme);
            if (settings.elegantMode !== undefined) localStorage.setItem('elegant-mode', settings.elegantMode.toString());
            if (settings.globalBorderRadius) localStorage.setItem('global-border-radius', settings.globalBorderRadius);
            if (settings.showTrackDurations !== undefined) localStorage.setItem('show-track-durations', settings.showTrackDurations.toString());
            if (settings.playbackQuality) localStorage.setItem('playback-quality', settings.playbackQuality);
            if (settings.libraryView) localStorage.setItem('libraryView', settings.libraryView);
            if (settings.volume) localStorage.setItem('volume', settings.volume);

            // Apply to storage modules
            const {
                themeManager,
                lastFMStorage,
                nowPlayingSettings,
                lyricsSettings,
                backgroundSettings,
                trackListSettings,
                cardSettings,
                waveformSettings,
                replayGainSettings,
                smoothScrollingSettings,
                downloadQualitySettings,
                coverArtSizeSettings,
                qualityBadgeSettings,
                visualizerSettings,
                bulkDownloadSettings,
            } = await import('../storage.js');

            if (settings.theme) themeManager.setTheme(settings.theme);
            if (settings.lastFM) {
                if (settings.lastFM.enabled !== undefined) lastFMStorage.setEnabled(settings.lastFM.enabled);
                if (settings.lastFM.loveOnLike !== undefined) lastFMStorage.setLoveOnLike(settings.lastFM.loveOnLike);
                if (settings.lastFM.sessionKey) lastFMStorage.setSessionKey(settings.lastFM.sessionKey);
            }
            if (settings.nowPlaying) nowPlayingSettings.setMode(settings.nowPlaying);
            if (settings.lyrics?.romajiMode !== undefined) lyricsSettings.setRomajiMode(settings.lyrics.romajiMode);
            if (settings.background) backgroundSettings.setSettings(settings.background);
            if (settings.trackList) trackListSettings.setSettings(settings.trackList);
            if (settings.cards) cardSettings.setSettings(settings.cards);
            if (settings.waveform) waveformSettings.setSettings(settings.waveform);
            if (settings.replayGain) replayGainSettings.setSettings(settings.replayGain);
            if (settings.smoothScrolling) smoothScrollingSettings.setSettings(settings.smoothScrolling);
            if (settings.downloadQuality) downloadQualitySettings.setQuality(settings.downloadQuality);
            if (settings.coverArtSize) coverArtSizeSettings.setSize(settings.coverArtSize);
            if (settings.qualityBadge) qualityBadgeSettings.setSettings(settings.qualityBadge);
            if (settings.visualizer) visualizerSettings.setSettings(settings.visualizer);
            if (settings.bulkDownload) bulkDownloadSettings.setSettings(settings.bulkDownload);

            // Trigger settings update event
            window.dispatchEvent(new CustomEvent('settings-changed'));
        } catch (error) {
            console.error('Error applying synced settings:', error);
        }
    },

    // === SOCIAL FEATURES ===

    // Generate and sync friend code
    async generateFriendCode() {
        if (!this._canSync()) return null;

        await this._ensureUserExists();
        const userId = this._getUserId();

        // Generate 6-character random code
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let friendCode = '';
        for (let i = 0; i < 6; i++) {
            friendCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT OR REPLACE INTO friend_codes
                      (user_id, friend_code, created_at, last_changed)
                      VALUES (?, ?, ?, ?)`,
                args: [userId, friendCode, Date.now(), Date.now()],
            });
        });

        return friendCode;
    },

    // Get user's friend code
    async getFriendCode() {
        if (!this._canSync()) return null;

        const userId = this._getUserId();
        try {
            const result = await this.client.execute({
                sql: `SELECT friend_code FROM friend_codes WHERE user_id = ?`,
                args: [userId],
            });
            return result.rows[0]?.friend_code || null;
        } catch (error) {
            console.error('Error getting friend code:', error);
            return null;
        }
    },

    // Add friend by friend code
    async addFriendByCode(friendCode) {
        if (!this._canSync()) return false;

        await this._ensureUserExists();
        const userId = this._getUserId();

        try {
            // Find user by friend code
            const friendResult = await this.client.execute({
                sql: `SELECT user_id FROM friend_codes WHERE friend_code = ?`,
                args: [friendCode],
            });

            if (friendResult.rows.length === 0) {
                return false; // Friend code not found
            }

            const friendUserId = friendResult.rows[0].user_id;

            if (friendUserId === userId) {
                return false; // Can't add yourself
            }

            // Check if already friends or pending
            const existingResult = await this.client.execute({
                sql: `SELECT status FROM friends
                      WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)`,
                args: [userId, friendUserId, friendUserId, userId],
            });

            if (existingResult.rows.length > 0) {
                return false; // Already friends or pending
            }

            // Add friend request
            this._queueSync(async () => {
                await this.client.execute({
                    sql: `INSERT INTO friends (user_id, friend_user_id, status, created_at)
                          VALUES (?, ?, 'pending', ?)`,
                    args: [userId, friendUserId, Date.now()],
                });
            });

            return true;
        } catch (error) {
            console.error('Error adding friend:', error);
            return false;
        }
    },

    // Accept friend request
    async acceptFriendRequest(friendUserId) {
        if (!this._canSync()) return;

        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `UPDATE friends SET status = 'accepted', accepted_at = ?
                      WHERE user_id = ? AND friend_user_id = ? AND status = 'pending'`,
                args: [Date.now(), friendUserId, userId],
            });
        });
    },

    // Get friends list
    async getFriends() {
        if (!this._canSync()) return [];

        const userId = this._getUserId();

        try {
            const result = await this.client.execute({
                sql: `SELECT f.friend_user_id, f.status, f.created_at, f.accepted_at,
                             fc.friend_code
                      FROM friends f
                      LEFT JOIN friend_codes fc ON f.friend_user_id = fc.user_id
                      WHERE f.user_id = ? AND f.status = 'accepted'
                      UNION
                      SELECT f.user_id, f.status, f.created_at, f.accepted_at,
                             fc.friend_code
                      FROM friends f
                      LEFT JOIN friend_codes fc ON f.user_id = fc.user_id
                      WHERE f.friend_user_id = ? AND f.status = 'accepted'`,
                args: [userId, userId],
            });

            return result.rows;
        } catch (error) {
            console.error('Error getting friends:', error);
            return [];
        }
    },

    // Get pending friend requests
    async getPendingFriendRequests() {
        if (!this._canSync()) return [];

        const userId = this._getUserId();

        try {
            const result = await this.client.execute({
                sql: `SELECT f.user_id, f.created_at, fc.friend_code
                      FROM friends f
                      LEFT JOIN friend_codes fc ON f.user_id = fc.user_id
                      WHERE f.friend_user_id = ? AND f.status = 'pending'`,
                args: [userId],
            });

            return result.rows;
        } catch (error) {
            console.error('Error getting pending requests:', error);
            return [];
        }
    },

    // Update current activity
    async updateActivity(track, isPlaying, progressSeconds = 0) {
        if (!this._canSync()) return;

        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT OR REPLACE INTO user_activity
                      (user_id, track_data, is_playing, progress_seconds, started_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                args: [userId, JSON.stringify(track), isPlaying, progressSeconds, Date.now(), Date.now()],
            });

            // Also add to activity feed
            await this.client.execute({
                sql: `INSERT INTO activity_feed
                      (user_id, activity_type, activity_data, created_at, expires_at)
                      VALUES (?, 'started_track', ?, ?, ?)`,
                args: [userId, JSON.stringify(track), Date.now(), Date.now() + (24 * 60 * 60 * 1000)], // Expires in 24 hours
            });
        });
    },

    // Get friends' current activity
    async getFriendsActivity() {
        if (!this._canSync()) return [];

        const userId = this._getUserId();

        try {
            const result = await this.client.execute({
                sql: `SELECT ua.user_id, ua.track_data, ua.is_playing, ua.progress_seconds,
                             ua.started_at, ua.updated_at, fc.friend_code
                      FROM user_activity ua
                      INNER JOIN friends f ON (
                          (f.user_id = ? AND f.friend_user_id = ua.user_id) OR
                          (f.friend_user_id = ? AND f.user_id = ua.user_id)
                      )
                      LEFT JOIN friend_codes fc ON ua.user_id = fc.user_id
                      WHERE f.status = 'accepted'
                      AND ua.updated_at > ?`, // Only recent activity (last 10 minutes)
                args: [userId, userId, Date.now() - (10 * 60 * 1000)],
            });

            return result.rows.map(row => ({
                ...row,
                track_data: JSON.parse(row.track_data),
            }));
        } catch (error) {
            console.error('Error getting friends activity:', error);
            return [];
        }
    },

    // Get activity feed
    async getActivityFeed(limit = 50) {
        if (!this._canSync()) return [];

        const userId = this._getUserId();

        try {
            const result = await this.client.execute({
                sql: `SELECT af.activity_type, af.activity_data, af.created_at, fc.friend_code
                      FROM activity_feed af
                      INNER JOIN friends f ON (
                          (f.user_id = ? AND f.friend_user_id = af.user_id) OR
                          (f.friend_user_id = ? AND f.user_id = af.user_id)
                      )
                      LEFT JOIN friend_codes fc ON af.user_id = fc.user_id
                      WHERE f.status = 'accepted'
                      AND af.expires_at > ?
                      ORDER BY af.created_at DESC
                      LIMIT ?`,
                args: [userId, userId, Date.now(), limit],
            });

            return result.rows.map(row => ({
                ...row,
                activity_data: JSON.parse(row.activity_data),
            }));
        } catch (error) {
            console.error('Error getting activity feed:', error);
            return [];
        }
    },

    // Suggest track to friend
    async suggestTrackToFriend(friendUserId, track, message = '') {
        if (!this._canSync()) return;

        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT INTO track_suggestions
                      (from_user_id, to_user_id, track_data, message, created_at, status)
                      VALUES (?, ?, ?, ?, ?, 'pending')`,
                args: [userId, friendUserId, JSON.stringify(track), message, Date.now()],
            });
        });
    },

    // Get track suggestions
    async getTrackSuggestions() {
        if (!this._canSync()) return [];

        const userId = this._getUserId();

        try {
            const result = await this.client.execute({
                sql: `SELECT ts.id, ts.from_user_id, ts.track_data, ts.message,
                             ts.created_at, ts.status, fc.friend_code
                      FROM track_suggestions ts
                      LEFT JOIN friend_codes fc ON ts.from_user_id = fc.user_id
                      WHERE ts.to_user_id = ?
                      ORDER BY ts.created_at DESC`,
                args: [userId],
            });

            return result.rows.map(row => ({
                ...row,
                track_data: JSON.parse(row.track_data),
            }));
        } catch (error) {
            console.error('Error getting track suggestions:', error);
            return [];
        }
    },

    // Mark suggestion as seen/accepted/declined
    async updateSuggestionStatus(suggestionId, status) {
        if (!this._canSync()) return;

        this._queueSync(async () => {
            await this.client.execute({
                sql: `UPDATE track_suggestions SET status = ? WHERE id = ?`,
                args: [status, suggestionId],
            });
        });
    },

    // Share playlist with friend
    async sharePlaylistWithFriend(playlistId, friendUserId, permission = 'view') {
        if (!this._canSync()) return;

        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT OR REPLACE INTO playlist_shares
                      (playlist_id, owner_user_id, shared_with_user_id, permission, created_at)
                      VALUES (?, ?, ?, ?, ?)`,
                args: [playlistId, userId, friendUserId, permission, Date.now()],
            });
        });
    },

    // Get shared playlists
    async getSharedPlaylists() {
        if (!this._canSync()) return [];

        const userId = this._getUserId();

        try {
            const result = await this.client.execute({
                sql: `SELECT ps.playlist_id, ps.owner_user_id, ps.permission, ps.created_at,
                             up.playlist_data, fc.friend_code
                      FROM playlist_shares ps
                      INNER JOIN user_playlists up ON ps.playlist_id = up.playlist_id AND ps.owner_user_id = up.user_id
                      LEFT JOIN friend_codes fc ON ps.owner_user_id = fc.user_id
                      WHERE ps.shared_with_user_id = ?`,
                args: [userId],
            });

            return result.rows.map(row => ({
                ...row,
                playlist_data: JSON.parse(row.playlist_data),
            }));
        } catch (error) {
            console.error('Error getting shared playlists:', error);
            return [];
        }
    },

    // Sync collaborative playlist change
    async syncCollaborativeChange(playlistId, changeType, changeData) {
        if (!this._canSync()) return;

        const userId = this._getUserId();

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT INTO collaborative_changes
                      (playlist_id, user_id, change_type, change_data, created_at)
                      VALUES (?, ?, ?, ?, ?)`,
                args: [playlistId, userId, changeType, JSON.stringify(changeData), Date.now()],
            });
        });
    },

    // Get collaborative changes for playlist
    async getCollaborativeChanges(playlistId, since = 0) {
        if (!this._canSync()) return [];

        try {
            const result = await this.client.execute({
                sql: `SELECT cc.user_id, cc.change_type, cc.change_data, cc.created_at, fc.friend_code
                      FROM collaborative_changes cc
                      LEFT JOIN friend_codes fc ON cc.user_id = fc.user_id
                      WHERE cc.playlist_id = ? AND cc.created_at > ?
                      ORDER BY cc.created_at ASC`,
                args: [playlistId, since],
            });

            return result.rows.map(row => ({
                ...row,
                change_data: JSON.parse(row.change_data),
            }));
        } catch (error) {
            console.error('Error getting collaborative changes:', error);
            return [];
        }
    },

    // Create collaborative playlist
    async createCollaborativePlaylist(playlistData) {
        if (!this._canSync()) return;

        const userId = this._getUserId();
        const playlistId = `collab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        this._queueSync(async () => {
            await this.client.execute({
                sql: `INSERT INTO user_playlists
                      (user_id, playlist_id, playlist_data, is_collaborative, created_at, updated_at)
                      VALUES (?, ?, ?, 1, ?, ?)`,
                args: [userId, playlistId, JSON.stringify(playlistData), Date.now(), Date.now()],
            });
        });

        return playlistId;
    },
};

// Initialize sync manager
syncManager.init();

// Listen for auth changes
authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));

export { syncManager };