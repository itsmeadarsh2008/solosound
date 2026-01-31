-- Turso migration: create all required tables for instant seed-based sync with social features
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  seed_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sync INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friend_codes (
  user_id TEXT PRIMARY KEY,
  friend_code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_changed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  friend_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  UNIQUE(user_id, friend_user_id)
);
CREATE TABLE IF NOT EXISTS user_activity (
  user_id TEXT PRIMARY KEY,
  track_data TEXT,
  is_playing BOOLEAN DEFAULT FALSE,
  progress_seconds INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS track_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  track_data TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS playlist_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  shared_with_user_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'view',
  created_at INTEGER NOT NULL,
  UNIQUE(playlist_id, shared_with_user_id)
);
CREATE TABLE IF NOT EXISTS collaborative_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  change_data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_favorite_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  track_data TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, track_id)
);
CREATE TABLE IF NOT EXISTS user_favorite_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  album_data TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, album_id)
);
CREATE TABLE IF NOT EXISTS user_favorite_artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  artist_data TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE TABLE IF NOT EXISTS user_favorite_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  playlist_data TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, playlist_id)
);
CREATE TABLE IF NOT EXISTS user_favorite_mixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  mix_id TEXT NOT NULL,
  mix_data TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, mix_id)
);
CREATE TABLE IF NOT EXISTS user_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  playlist_data TEXT NOT NULL,
  is_collaborative BOOLEAN DEFAULT FALSE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, playlist_id)
);
CREATE TABLE IF NOT EXISTS user_playlist_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  folder_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, folder_id)
);
CREATE TABLE IF NOT EXISTS user_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  track_data TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  UNIQUE(user_id, track_id, played_at)
);
CREATE TABLE IF NOT EXISTS album_art (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  url TEXT NOT NULL,
  data TEXT,
  cached_at INTEGER NOT NULL,
  UNIQUE(user_id, album_id)
);
CREATE TABLE IF NOT EXISTS user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  settings_data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_favorite_tracks_user_id ON user_favorite_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorite_albums_user_id ON user_favorite_albums(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorite_artists_user_id ON user_favorite_artists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorite_playlists_user_id ON user_favorite_playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorite_mixes_user_id ON user_favorite_mixes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_playlists_user_id ON user_playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_playlist_folders_user_id ON user_playlist_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_played_at ON user_history(played_at);
CREATE INDEX IF NOT EXISTS idx_album_art_user_id ON album_art(user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_codes_code ON friend_codes(friend_code);
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_user_id ON friends(friend_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_status ON friends(status);
CREATE INDEX IF NOT EXISTS idx_user_activity_updated ON user_activity(updated_at);
CREATE INDEX IF NOT EXISTS idx_activity_feed_user_id ON activity_feed(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_feed_expires ON activity_feed(expires_at);
CREATE INDEX IF NOT EXISTS idx_track_suggestions_from_user ON track_suggestions(from_user_id);
CREATE INDEX IF NOT EXISTS idx_track_suggestions_to_user ON track_suggestions(to_user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_shares_playlist ON playlist_shares(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_shares_shared_with ON playlist_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_collaborative_changes_playlist ON collaborative_changes(playlist_id);
