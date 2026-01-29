//js/player.js
import { MediaPlayer } from 'dashjs';
import {
    REPEAT_MODE,
    formatTime,
    getTrackArtists,
    getTrackTitle,
    getTrackArtistsHTML,
    createQualityBadgeHTML,
} from './utils.js';
import { queueManager, replayGainSettings, backgroundSettings } from './storage.js';

export class Player {
    constructor(audioElement, api, quality = 'HI_RES_LOSSLESS') {
        this.audio = audioElement;
        this.api = api;
        this.quality = quality;
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.shuffleActive = false;
        this.repeatMode = REPEAT_MODE.OFF;
        this.preloadCache = new Map();
        this.preloadAbortController = null;
        this.currentTrack = null;
        this.currentRgValues = null;
        this.userVolume = parseFloat(localStorage.getItem('volume') || '0.7');

        // Sleep timer properties
        this.sleepTimer = null;
        this.sleepTimerEndTime = null;
        this.sleepTimerInterval = null;

        // Initialize dash.js player
        this.dashPlayer = MediaPlayer().create();
        this.dashPlayer.updateSettings({
            streaming: {
                buffer: {
                    fastSwitchEnabled: true,
                },
            },
        });

        // Listen for settings changes to update the dynamic background immediately
        window.addEventListener('album-background-toggle', (e) => {
            try {
                const dyn = document.getElementById('dynamic-background');
                if (!dyn) return;
                const enabled = !!e.detail?.enabled;
                if (!enabled) {
                    dyn.classList.remove('active');
                    dyn.style.opacity = '0';
                    dyn.style.backgroundImage = '';
                    return;
                }
                // If enabled and we have a current track, refresh the image and apply animation state
                if (this.currentTrack?.album?.cover) {
                    const large = this.api.getCoverUrl(this.currentTrack.album.cover, '1280');
                    dyn.style.backgroundImage = `url('${large}')`;
                    dyn.style.opacity = '1';
                    if (backgroundSettings.isAnimated()) dyn.classList.add('active');
                }
            } catch (err) {
                console.warn('album-background-toggle handler error', err);
            }
        });

        window.addEventListener('background-animation-toggle', (e) => {
            try {
                const dyn = document.getElementById('dynamic-background');
                if (!dyn) return;
                const enabled = !!e.detail?.enabled;
                if (enabled && backgroundSettings.isEnabled()) dyn.classList.add('active');
                else dyn.classList.remove('active');
            } catch (err) {
                console.warn('background-animation-toggle handler error', err);
            }
        });
        this.dashInitialized = false;
        // Track DASH failures per-track so we can skip DASH attempts for tracks that repeatedly fail
        this._badDashTrackCache = new Map(); // trackId -> { count, blockedUntil }
        this._badDashFailureThreshold = 2; // number of failed attempts before blocking
        this._badDashBlockDurationMs = 10 * 60 * 1000; // block duration (10 minutes)

        this.loadQueueState();
        this.setupMediaSession();

        window.addEventListener('beforeunload', () => {
            this.saveQueueState();
        });
    }

    setVolume(value) {
        this.userVolume = Math.max(0, Math.min(1, value));
        localStorage.setItem('volume', this.userVolume);
        this.applyReplayGain();
    }

    applyReplayGain() {
        const mode = replayGainSettings.getMode(); // 'off', 'track', 'album'
        let gainDb = 0;
        let peak = 1.0;

        if (mode !== 'off' && this.currentRgValues) {
            const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude } = this.currentRgValues;

            if (mode === 'album' && albumReplayGain !== undefined) {
                gainDb = albumReplayGain;
                peak = albumPeakAmplitude || 1.0;
            } else if (trackReplayGain !== undefined) {
                gainDb = trackReplayGain;
                peak = trackPeakAmplitude || 1.0;
            }

            // Apply Pre-Amp
            gainDb += replayGainSettings.getPreamp();
        }

        // Convert dB to linear scale: 10^(dB/20)
        let scale = Math.pow(10, gainDb / 20);

        // Peak protection (prevent clipping)
        if (scale * peak > 1.0) {
            scale = 1.0 / peak;
        }

        // Calculate effective volume
        const effectiveVolume = this.userVolume * scale;

        // Apply to audio element
        this.audio.volume = Math.max(0, Math.min(1, effectiveVolume));
    }

    loadQueueState() {
        const savedState = queueManager.getQueue();
        if (savedState) {
            this.queue = savedState.queue || [];
            this.shuffledQueue = savedState.shuffledQueue || [];
            this.originalQueueBeforeShuffle = savedState.originalQueueBeforeShuffle || [];
            this.currentQueueIndex = savedState.currentQueueIndex ?? -1;
            this.shuffleActive = savedState.shuffleActive || false;
            this.repeatMode = savedState.repeatMode !== undefined ? savedState.repeatMode : REPEAT_MODE.OFF;

            // Restore current track if queue exists and index is valid
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            if (this.currentQueueIndex >= 0 && this.currentQueueIndex < currentQueue.length) {
                this.currentTrack = currentQueue[this.currentQueueIndex];

                // Restore UI
                const track = this.currentTrack;
                const trackTitle = getTrackTitle(track);
                const trackArtistsHTML = getTrackArtistsHTML(track);

                let yearDisplay = '';
                const releaseDate = track.album?.releaseDate || track.streamStartDate;
                if (releaseDate) {
                    const date = new Date(releaseDate);
                    if (!isNaN(date.getTime())) {
                        yearDisplay = ` • ${date.getFullYear()}`;
                    }
                }

                const coverEl = document.querySelector('.now-playing-bar .cover');
                const titleEl = document.querySelector('.now-playing-bar .title');
                const albumEl = document.querySelector('.now-playing-bar .album');
                const artistEl = document.querySelector('.now-playing-bar .artist');

                if (coverEl) coverEl.src = this.api.getCoverUrl(track.album?.cover);

                // Update dynamic background to match current track
                try { this.updateDynamicBackgroundForTrack(track); } catch (e) {}

                if (titleEl) {
                    // Only set the title text (no details)
                    titleEl.textContent = trackTitle;
                }
                // Inject quality/details row
                const qualityRowEl = document.querySelector('.now-playing-bar .now-quality-row');
                if (qualityRowEl) {
                    import('./utils.js')
                        .then(({ createNowPlayingTitleHTML }) => {
                            // Only extract the details row from the generated HTML
                            const temp = document.createElement('div');
                            temp.innerHTML = createNowPlayingTitleHTML(track);
                            const details = temp.querySelector('.now-quality-row');
                            qualityRowEl.innerHTML = details ? details.innerHTML : '';
                        })
                        .catch(() => {
                            qualityRowEl.innerHTML = '';
                        });
                }
                if (albumEl) {
                    const albumTitle = track.album?.title || '';
                    if (albumTitle && albumTitle !== trackTitle) {
                        albumEl.textContent = albumTitle;
                        albumEl.style.display = 'block';
                    } else {
                        albumEl.textContent = '';
                        albumEl.style.display = 'none';
                    }
                }
                if (artistEl) artistEl.innerHTML = trackArtistsHTML + yearDisplay;

                const mixBtn = document.getElementById('now-playing-mix-btn');
                if (mixBtn) {
                    mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
                }
                const totalDurationEl = document.getElementById('total-duration');
                if (totalDurationEl) totalDurationEl.textContent = formatTime(track.duration);
                document.title = `${trackTitle} • ${getTrackArtists(track)}`;

                this.updatePlayingTrackIndicator();
                this.updateMediaSession(track);
                // Warm upcoming tracks upon restore
                try { this.preloadNextTracks(); } catch (e) {}
            }
        }
    }

    saveQueueState() {
        queueManager.saveQueue({
            queue: this.queue,
            shuffledQueue: this.shuffledQueue,
            originalQueueBeforeShuffle: this.originalQueueBeforeShuffle,
            currentQueueIndex: this.currentQueueIndex,
            shuffleActive: this.shuffleActive,
            repeatMode: this.repeatMode,
        });
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            this.audio.play().catch(console.error);
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            this.audio.pause();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            this.playPrev();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.playNext();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekBackward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekForward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.audio.currentTime = Math.max(0, details.seekTime);
                this.updateMediaSessionPositionState();
            }
        });

        navigator.mediaSession.setActionHandler('stop', () => {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.updateMediaSessionPlaybackState();
        });
    }

    // Update dynamic background and page-level background using album art
    updateDynamicBackgroundForTrack(track) {
        try {
            const dyn = document.getElementById('dynamic-background');
            if (!dyn) return;

            if (!backgroundSettings.isEnabled()) {
                dyn.classList.remove('active');
                dyn.style.opacity = '0';
                dyn.style.backgroundImage = '';
                try {
                    const pageBg = document.getElementById('page-background');
                    if (pageBg) {
                        pageBg.classList.remove('active');
                        pageBg.style.backgroundImage = '';
                    }
                } catch (err) {
                    console.warn('Failed to clear page-background', err);
                }
                return;
            }

            if (!track || !track.album || !track.album.cover) {
                // Clear if missing cover
                dyn.classList.remove('active');
                dyn.style.opacity = '0';
                dyn.style.backgroundImage = '';
                return;
            }

            // Pick sensible sizes for small vs large viewports to save bandwidth
            const smallSize = window.innerWidth <= 720 ? '320' : '640';
            const largeSize = '1280';
            const small = this.api.getCoverUrl(track.album.cover, smallSize);
            const large = this.api.getCoverUrl(track.album.cover, largeSize);

            // cross-fade: swap image to small first, then swap to large once loaded
            dyn.classList.remove('active');
            dyn.style.opacity = '0';

            // set overlay color if available (use a stronger alpha for contrast)
            const highlight = getComputedStyle(document.documentElement).getPropertyValue('--highlight-rgb').trim();
            if (highlight) {
                dyn.style.setProperty('--dyn-overlay', `rgba(${highlight}, 0.32)`);
            } else {
                dyn.style.setProperty('--dyn-overlay', 'rgba(0,0,0,0.32)');
            }

            // Use low-res for immediate paint then replace with high-res when ready
            dyn.style.backgroundImage = `url('${small}')`;

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                dyn.style.backgroundImage = `url('${large}')`;
                try {
                    const pageBg = document.getElementById('page-background');
                    if (pageBg) {
                        pageBg.style.backgroundImage = `url('${large}')`;
                        pageBg.classList.add('active');
                    }
                } catch (err) {
                    console.warn('Failed to update page-background', err);
                }
            };
            img.onerror = () => {};
            img.src = large;

            // Small tick to ensure transition works across browsers
            requestAnimationFrame(() => {
                if (backgroundSettings.isAnimated()) dyn.classList.add('active');
                else dyn.classList.remove('active');
                dyn.style.opacity = '1';
            });
        } catch (e) {
            console.warn('updateDynamicBackgroundForTrack error', e);
        }
    }

    setQuality(quality) {
        this.quality = quality;
    }

    async preloadNextTracks() {
        if (this.preloadAbortController) {
            this.preloadAbortController.abort();
            // Clean any injected preload hints from previous runs
            try {
                document.head.querySelectorAll('link[data-preload-for]').forEach((n) => n.remove());
            } catch (e) {}
        }

        this.preloadAbortController = new AbortController();
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const tracksToPreload = [];

        for (let i = 1; i <= 2; i++) {
            const nextIndex = this.currentQueueIndex + i;
            if (nextIndex < currentQueue.length) {
                tracksToPreload.push({ track: currentQueue[nextIndex], index: nextIndex });
            }
        }

        for (const { track } of tracksToPreload) {
            if (this.preloadCache.has(track.id)) continue;
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            if (track.isLocal || isTracker || (track.audioUrl && !track.isLocal)) continue;
            try {
                const streamUrl = await this.api.getStreamUrl(track.id, this.quality);

                if (this.preloadAbortController.signal.aborted) break;

                this.preloadCache.set(track.id, streamUrl);
                // Add a preload hint and warm a small range to populate the browser cache.
                try {
                    if (!streamUrl.startsWith('blob:')) {
                        // Remove any existing preload for the same track id
                        document.head.querySelectorAll(`link[data-preload-for="${track.id}"]`).forEach((n) => n.remove());

                        const link = document.createElement('link');
                        link.rel = 'preload';
                        link.as = 'audio';
                        link.href = streamUrl;
                        link.crossOrigin = 'anonymous';
                        link.dataset.preloadFor = track.id;
                        document.head.appendChild(link);

                        // Warm a small range to help speed up first-play and caching
                        fetch(streamUrl, {
                            method: 'GET',
                            headers: { Range: 'bytes=0-65535' },
                            signal: this.preloadAbortController.signal,
                        }).catch(() => {});
                    }
                } catch (e) {
                    // ignore any preload failures
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    async playTrackFromQueue(startTime = 0, recursiveCount = 0) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        const track = currentQueue[this.currentQueueIndex];
        if (track.isUnavailable) {
            console.warn(`Attempted to play unavailable track: ${track.title}. Skipping...`);
            this.playNext();
            return;
        }

        this.saveQueueState();

        this.currentTrack = track;

        const trackTitle = getTrackTitle(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);

        let yearDisplay = '';
        const releaseDate = track.album?.releaseDate || track.streamStartDate;
        if (releaseDate) {
            const date = new Date(releaseDate);
            if (!isNaN(date.getTime())) {
                yearDisplay = ` • ${date.getFullYear()}`;
            }
        }

        document.querySelector('.now-playing-bar .cover').src = this.api.getCoverUrl(track.album?.cover);
        const qualityBadge = createQualityBadgeHTML(track);
        document.querySelector('.now-playing-bar .title').innerHTML = `${trackTitle} ${qualityBadge}`;
        const albumEl = document.querySelector('.now-playing-bar .album');
        if (albumEl) {
            const albumTitle = track.album?.title || '';
            if (albumTitle && albumTitle !== trackTitle) {
                albumEl.textContent = albumTitle;
                albumEl.style.display = 'block';
            } else {
                albumEl.textContent = '';
                albumEl.style.display = 'none';
            }
        }
        document.querySelector('.now-playing-bar .artist').innerHTML = trackArtistsHTML + yearDisplay;

        // Update the dynamic background immediately for this track
        try { this.updateDynamicBackgroundForTrack(track); } catch (e) {}

        const mixBtn = document.getElementById('now-playing-mix-btn');
        if (mixBtn) {
            mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
        }
        document.title = `${trackTitle} • ${getTrackArtists(track)}`;

        this.updatePlayingTrackIndicator();
        this.updateMediaSession(track);
        this.updateMediaSessionPlaybackState();

        try {
            let streamUrl;

            // small retry tracker per track
            if (!this._playRetries) this._playRetries = new Map();
            const retries = this._playRetries.get(track.id) || 0;

            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));

            if (isTracker || (track.audioUrl && !track.isLocal)) {
                if (this.dashInitialized) {
                    this.dashPlayer.reset();
                    this.dashInitialized = false;
                }
                streamUrl = track.audioUrl;

                if (
                    (!streamUrl || (typeof streamUrl === 'string' && streamUrl.startsWith('blob:'))) &&
                    track.remoteUrl
                ) {
                    streamUrl = track.remoteUrl;
                }

                if (!streamUrl) {
                        // Try to resolve any available quality using the streaming priority list
                        try {
                            const { STREAM_QUALITY_PRIORITY } = await import('./utils.js');
                            for (const q of STREAM_QUALITY_PRIORITY) {
                                try {
                                    const alt = await this.api.getStreamUrl(track.id, q);
                                    if (alt) {
                                        streamUrl = alt;
                                        // store best-effort playback quality on the track (candidate)
                                        track.playbackQuality = q;
                                        try {
                                            const { normalizeQualityToken } = await import('./utils.js');
                                            track.playbackQualityToken = normalizeQualityToken(q);
                                        } catch (e) {
                                            track.playbackQualityToken = null;
                                        }
                                }
                            } catch (e) {}
                        }
                    } catch (e) {}

                    if (!streamUrl) {
                        console.warn(`Track ${trackTitle} audio URL is missing after probe. Marking as unavailable.`);
                        track.isUnavailable = true;
                        this.playNext();
                        return;
                    }
                }

                if (isTracker && !streamUrl.startsWith('blob:') && streamUrl.startsWith('http')) {
                    try {
                        const response = await fetch(streamUrl);
                        if (response.ok) {
                            const blob = await response.blob();
                            streamUrl = URL.createObjectURL(blob);
                        }
                    } catch (e) {
                        console.warn('Failed to fetch tracker blob, trying direct link', e);
                    }
                }

                this.currentRgValues = null;
                this.applyReplayGain();

                // Use resilient play flow
                const urlToPlay = await this._ensurePlayableSource(streamUrl);
                if (startTime > 0) this.audio.currentTime = startTime;
                await this._playUrlWithFallback(urlToPlay, track, startTime);
            } else if (track.isLocal && track.file) {
                if (this.dashInitialized) {
                    this.dashPlayer.reset(); // Ensure dash is off
                    this.dashInitialized = false;
                }
                streamUrl = URL.createObjectURL(track.file);
                this.currentRgValues = null; // No replaygain for local files yet
                this.applyReplayGain();

                const urlToPlay = await this._ensurePlayableSource(streamUrl);
                if (startTime > 0) this.audio.currentTime = startTime;
                await this._playUrlWithFallback(urlToPlay, track, startTime);
            } else {
                // Get track data for ReplayGain (should be cached by API)
                const trackData = await this.api.getTrack(track.id, this.quality);

                if (trackData && trackData.info) {
                    this.currentRgValues = {
                        trackReplayGain: trackData.info.trackReplayGain,
                        trackPeakAmplitude: trackData.info.trackPeakAmplitude,
                        albumReplayGain: trackData.info.albumReplayGain,
                        albumPeakAmplitude: trackData.info.albumPeakAmplitude,
                    };
                } else {
                    this.currentRgValues = null;
                }
                this.applyReplayGain();

                if (this.preloadCache.has(track.id)) {
                    streamUrl = this.preloadCache.get(track.id);
                } else if (trackData.originalTrackUrl) {
                    streamUrl = trackData.originalTrackUrl;
                } else {
                    streamUrl = this.api.extractStreamUrlFromManifest(trackData.info.manifest);
                }

                // Handle playback
                // Route all resolved stream URLs through the unified _ensurePlayableSource/_playUrlWithFallback
                try {
                    if (this.dashInitialized) {
                        this.dashPlayer.reset();
                        this.dashInitialized = false;
                    }
                } catch (e) {
                    // ignore reset errors
                }

                // If a blob MPD is present, it will be identified by _ensurePlayableSource => { kind: 'dash', url }
                const urlToPlay = await this._ensurePlayableSource(streamUrl);

                // If the track has been flagged as a repeated DASH failure, skip DASH proactively
                const badInfo = this._badDashTrackCache.get(track.id);
                if (badInfo && badInfo.blockedUntil && badInfo.blockedUntil > Date.now()) {
                    console.info('Skipping known-bad DASH for track', track.id);
                    // Force fallback by hunting for other qualities
                    try {
                        const { STREAM_QUALITY_PRIORITY } = await import('./utils.js');
                        for (const q of STREAM_QUALITY_PRIORITY) {
                            if (q === this.quality) continue; // already attempted
                            try {
                                const alt = await this.api.getStreamUrl(track.id, q);
                                if (alt && alt !== streamUrl) {
                                    const playableAlt = await this._ensurePlayableSource(alt);
                                    const ok = await (async () => {
                                        try {
                                            return await this._playUrlWithFallback(playableAlt, track, startTime);
                                        } catch (e) {
                                            return false;
                                        }
                                    })();
                                    if (ok) {
                                        return;
                                    }
                                }
                            } catch (e) {}
                        }
                    } catch (e) {}
                }

                // Let the fallback loop try this candidate (which may be a DASH kind or regular URL)
                await this._playUrlWithFallback(urlToPlay, track, startTime);
            }

            this.preloadNextTracks();
        } catch (error) {
            console.error(`Could not play track: ${trackTitle}`, error);

            // Provide persistent actions: Retry or Mark Unavailable. Do NOT auto-skip.
            try {
                const { showActionNotification } = await import('./downloads.js');
                showActionNotification(`Playback failed: ${trackTitle}`, 'Retry', () => {
                    this.playTrackFromQueue(startTime, recursiveCount);
                }, { persistent: true });

                showActionNotification(`Playback failed: ${trackTitle}`, 'Mark Unavailable', () => {
                    track.isUnavailable = true;
                    this.playNext();
                }, { persistent: true });
            } catch (e) {
                // As a last resort, mark unavailable and skip to avoid blocking playback forever
                track.isUnavailable = true;
                this.playNext();
            }
        }
    }

    playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            this.playTrackFromQueue(0, 0);
        }
    }

    async _probeUrl(url) {
        try {
            const resp = await fetch(url, { method: 'HEAD' });
            if (!resp.ok) return { ok: false };
            return { ok: true, contentType: resp.headers.get('content-type') };
        } catch (e) {
            return { ok: false };
        }
    }

    async _ensurePlayableSource(url) {
        if (!url) throw new Error('No source URL');
        if (typeof url !== 'string') throw new Error('Invalid source');

        // If blob URL may still be DASH manifest or other streaming manifest. Inspect it.
        if (url.startsWith('blob:')) {
            try {
                const resp = await fetch(url);
                if (resp.ok) {
                    const ct = resp.headers.get('content-type') || '';
                    // DASH manifest
                    if (ct.includes('application/dash+xml')) return { kind: 'dash', url };
                    // HLS (m3u8) detection by text content
                    const text = await resp.text();
                    if (/\b<\?xml\b|<MPD\b|application\/dash\+xml/i.test(text)) return { kind: 'dash', url };
                    if (/^#EXTM3U/m.test(text)) return { kind: 'hls', url };
                    // If it looks like audio (binary) or large blob, assume playable
                    if (resp.headers.get('content-length') && Number(resp.headers.get('content-length')) > 1024) return url;
                }
            } catch (e) {
                // fallback to treating as raw URL
                return url;
            }
            return url;
        }

        // Try HEAD to detect content-type
        try {
            const head = await this._probeUrl(url);
            const ct = (head && head.contentType) || '';
            if (head.ok && ct) {
                if (ct.includes('audio')) return url;
                if (ct.includes('application/dash+xml')) return { kind: 'dash', url };
                if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegURL')) return { kind: 'hls', url };
            }
        } catch (e) {
            // fallthrough to GET
        }

        // GET and inspect blob content-type/text
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to fetch');
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('audio')) return url;
            if (ct.includes('application/dash+xml')) return { kind: 'dash', url };
            if (/^#EXTM3U/m.test(await resp.clone().text())) return { kind: 'hls', url };

            const blob = await resp.blob();
            if (blob.type && blob.type.includes('audio')) return URL.createObjectURL(blob);
            // Heuristic: if blob is reasonably large assume it's audio
            if (blob.size > 1024) return URL.createObjectURL(blob);

            throw new Error(`Fetched resource is not audio (type: ${blob.type})`);
        } catch (e) {
            throw e;
        }
    }

    async _playUrlWithFallback(initialUrl, track, startTime = 0) {
        // Robust unified fallback logic that attempts all quality candidates
        const candidates = [];
        const push = (entry) => {
            if (!entry) return;
            if (typeof entry === 'string') candidates.push({ url: entry });
            else if (entry && typeof entry === 'object') candidates.push(entry);
        };

        push(initialUrl);

        // Build ordered candidates from streaming priority list and honor user preference when present
        try {
            const { STREAM_QUALITY_PRIORITY } = await import('./utils.js');
            const baseOrder = STREAM_QUALITY_PRIORITY.slice();
            // If player has a preferred quality, move it to the front while retaining relative priority
            let list = baseOrder;
            if (this.quality) {
                const idx = baseOrder.indexOf(this.quality);
                if (idx > 0) {
                    list = [this.quality, ...baseOrder.slice(0, idx), ...baseOrder.slice(idx + 1)];
                }
            }

            for (const q of list) {
                try {
                    const alt = await this.api.getStreamUrl(track.id, q);
                    if (alt) push({ url: alt, quality: q });
                } catch (e) {
                    // ignore missing quality for this track
                }
            }
        } catch (e) {
            console.warn('Could not build candidate quality list', e);
        }

        // Deduplicate candidates
        const seen = new Set();
        const unique = candidates.filter((c) => {
            if (!c || !c.url) return false;
            const u = c.url;
            if (seen.has(u)) return false;
            seen.add(u);
            return true;
        });

        // Helper to try to play a single URL with fallback attempts
        const tryPlay = async (candidate) => {
            const MAX_ATTEMPTS = 2;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                // Resolve kind/url via _ensurePlayableSource when possible
                try {
                    const playable = await this._ensurePlayableSource(candidate.url);

                    // DASH/HLS handling
                    if (playable && typeof playable === 'object' && (playable.kind === 'dash' || playable.kind === 'hls')) {
                        if (playable.kind === 'dash') {
                            try {
                                // Quick manifest inspection: if MPD contains FLAC codec, it's often not playable in-browser via dash.js.
                                try {
                                    const resp = await fetch(playable.url);
                                    if (resp && resp.ok) {
                                        const text = await resp.text();
                                        if (/codecs\s*=\s*["']?[^"'>]*flac/i.test(text) || /<Representation[^>]*codecs=["'][^"']*flac[^"']*["']/i.test(text)) {
                                            console.info('Skipping DASH candidate: MPD uses FLAC codec which is not supported in this browser.');
                                            return false; // allow fallback to try LOSSLESS/other qualities
                                        }
                                    }
                                } catch (e) {
                                    // If manifest fetch fails we'll fall back to the normal attempt below
                                }

                                if (this.dashInitialized) this.dashPlayer.attachSource(playable.url);
                                else {
                                    this.dashPlayer.initialize(this.audio, playable.url, true);
                                    this.dashInitialized = true;
                                }
                                if (startTime > 0 && this.dashInitialized) this.dashPlayer.seek(startTime);

                                // Wait for a short window to detect whether playback actually starts.
                                // If we don't see 'playing' or a successful audio play() within the timeout, treat as failure so fallback can attempt the next candidate.
                                const success = await new Promise((resolve) => {
                                    let settled = false;
                                    const onPlaying = () => {
                                        if (!settled) {
                                            settled = true;
                                            cleanup();
                                            resolve(true);
                                        }
                                    };
                                    const onError = () => {
                                        if (!settled) {
                                            settled = true;
                                            cleanup();
                                            resolve(false);
                                        }
                                    };
                                    const timeoutId = setTimeout(() => {
                                        if (!settled) {
                                            settled = true;
                                            cleanup();
                                            resolve(false);
                                        }
                                    }, 5000);

                                    const cleanup = () => {
                                        this.audio.removeEventListener('playing', onPlaying);
                                        this.audio.removeEventListener('error', onError);
                                        clearTimeout(timeoutId);
                                    };

                                    this.audio.addEventListener('playing', onPlaying, { once: true });
                                    this.audio.addEventListener('error', onError, { once: true });

                                    // Attempt to kickstart play (dash.js may already be auto-playing but a manual trigger helps)
                                    try {
                                        this.audio.play().catch(() => {});
                                    } catch (e) {
                                        // ignore
                                    }
                                });

                                if (success) {
                                    // On success, clear any recorded DASH failures for this track
                                    if (track && track.id) this._badDashTrackCache.delete(track.id);
                                    return true;
                                }

                                // DASH candidate failed to start -> increment failure counter and possibly block
                                try {
                                    if (track && track.id) {
                                        const prev = this._badDashTrackCache.get(track.id) || { count: 0, blockedUntil: 0 };
                                        prev.count = (prev.count || 0) + 1;
                                        if (prev.count >= this._badDashFailureThreshold) {
                                            prev.blockedUntil = Date.now() + this._badDashBlockDurationMs;
                                            console.info('Marking DASH as blocked for track', track.id, 'until', new Date(prev.blockedUntil).toISOString());
                                        }
                                        this._badDashTrackCache.set(track.id, prev);
                                    }
                                } catch (e) {}

                                try {
                                    if (this.dashInitialized) {
                                        this.dashPlayer.reset();
                                        this.dashInitialized = false;
                                    }
                                } catch (e) {
                                    console.warn('Failed to reset dash player after failed attempt', e);
                                }

                                return false;
                            } catch (e) {
                                // Treat as failed candidate and allow fallback to next
                                try {
                                    if (this.dashInitialized) {
                                        this.dashPlayer.reset();
                                        this.dashInitialized = false;
                                    }
                                } catch (e2) {}
                                return false;
                            }
                        }
                        if (playable.kind === 'hls') {
                            this.audio.src = playable.url;
                            if (startTime > 0) this.audio.currentTime = startTime;
                            await this.audio.play();
                            return true;
                        }
                    }

                    // At this point playable may be a resolved URL string or we use candidate.url
                    const finalUrl = typeof playable === 'string' ? playable : candidate.url;

                    // Quick HEAD probe to avoid HTML error pages
                    try {
                        const head = await this._probeUrl(finalUrl);
                        const ct = (head && head.contentType) ? (head.contentType || '').toLowerCase() : '';
                        if (head && !head.ok) throw new Error('HEAD not ok');
                        if (ct.includes('text/html')) throw new Error('HTML response detected');
                    } catch (e) {
                        // If HEAD fails or indicates HTML, try a small GET for signature check
                        try {
                            const resp = await fetch(finalUrl, { method: 'GET', headers: { Range: 'bytes=0-65535' } });
                            if (!resp.ok) throw new Error('GET probe failed');
                            const ctt = (resp.headers.get('content-type') || '').toLowerCase();
                            if (ctt.includes('text/html')) throw new Error('HTML response detected');

                            // If not clearly audio, inspect blob signature
                            if (!ctt.includes('audio') && !ctt.includes('application/dash+xml') && !/^#EXTM3U/m.test(await resp.clone().text())) {
                                const blob = await resp.blob();
                                const { getExtensionFromBlob } = await import('./utils.js');
                                const ext = await getExtensionFromBlob(blob).catch(() => null);
                                if (!ext) throw new Error('Could not verify audio signature');
                                const objectUrl = URL.createObjectURL(blob);
                                this.audio.src = objectUrl;
                                if (startTime > 0) this.audio.currentTime = startTime;
                                await this.audio.play();
                                return true;
                            }
                        } catch (e2) {
                            // continue to a normal attempt below
                        }
                    }

                    // Normal attempt: set src and play
                    this.audio.src = finalUrl;
                    if (startTime > 0) this.audio.currentTime = startTime;
                    await this.audio.play();
                    return true;
                } catch (err) {
                    console.warn(`Play attempt ${attempt} failed for ${candidate.url}`, err);
                    // small backoff
                    await new Promise((r) => setTimeout(r, 250 * attempt));
                    // continue to next attempt
                }
            }
            return false;
        };

        // Try each candidate thoroughly
        for (const c of unique) {
            try {
                const success = await tryPlay(c);
                if (success) {
                    if (this._playRetries) this._playRetries.delete(track.id);
                    // Record which candidate succeeded so UI can reflect actual played quality
                    try {
                        // Normalize playback quality token so UI can display correct badge
                        const rawQuality = (c.quality || c.qualityLabel || c.mime || '').toString();
                        track.playbackQuality = rawQuality;
                        try {
                            const { normalizeQualityToken } = await import('./utils.js');
                            track.playbackQualityToken = normalizeQualityToken(rawQuality);
                        } catch (e) {
                            track.playbackQualityToken = null;
                        }

                        console.info('Playback candidate successful:', c.url, 'quality:', track.playbackQualityToken || track.playbackQuality);

                        // Update now-playing title and details if present
                        try {
                            const titleEl = document.querySelector('.now-playing-bar .title');
                            if (titleEl) {
                                titleEl.textContent = track.title || '';
                            }
                            const qualityRowEl = document.querySelector('.now-playing-bar .now-quality-row');
                            if (qualityRowEl) {
                                const { createNowPlayingTitleHTML } = await import('./utils.js');
                                const temp = document.createElement('div');
                                temp.innerHTML = createNowPlayingTitleHTML(track);
                                const details = temp.querySelector('.now-quality-row');
                                qualityRowEl.innerHTML = details ? details.innerHTML : '';
                            }
                        } catch (e) {}
                    } catch (e) {}
                    return;
                }
            } catch (e) {
                console.warn('Candidate failed, trying next', e);
            }
        }

        // Last-resort: try decoding blobs with AudioContext for each candidate
        try {
            const ctx = window.__appAudioContext || (window.__appAudioContext = new (window.AudioContext || window.webkitAudioContext)());
            for (const c of unique) {
                try {
                    const resp = await fetch(c.url);
                    if (!resp.ok) continue;
                    const blob = await resp.blob();
                    if (!blob || blob.size < 1024) continue;
                    try {
                        const arr = await blob.arrayBuffer();
                        await ctx.decodeAudioData(arr.slice(0));
                        const obj = URL.createObjectURL(blob);
                        this.audio.src = obj;
                        if (startTime > 0) this.audio.currentTime = startTime;
                        await this.audio.play();
                        if (this._playRetries) this._playRetries.delete(track.id);
                        return;
                    } catch (e) {
                        // decode failed - move on
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Exhausted all strategies — provide user with Retry and Mark Unavailable actions
        try {
            const { showActionNotification } = await import('./downloads.js');
            showActionNotification(`Playback failed: ${getTrackTitle(track)}`, 'Retry', () => {
                this.playTrackFromQueue(startTime, 0);
            }, { persistent: true });

            showActionNotification(`Playback failed: ${getTrackTitle(track)}`, 'Mark Unavailable', () => {
                track.isUnavailable = true;
                this.playNext();
            }, { persistent: true });
        } catch (e) {
            console.warn('Failed to show action notification', e);
        }

        throw new Error('All playback candidates failed');
    }

    playNext(recursiveCount = 0) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;

        if (recursiveCount > currentQueue.length) {
            console.error('All tracks in queue are unavailable.');
            this.audio.pause();
            return;
        }

        if (this.repeatMode === REPEAT_MODE.ONE && !currentQueue[this.currentQueueIndex]?.isUnavailable) {
            this.playTrackFromQueue(0, recursiveCount);
            return;
        }

        if (!isLastTrack) {
            this.currentQueueIndex++;
            // Skip unavailable tracks
            if (currentQueue[this.currentQueueIndex].isUnavailable) {
                return this.playNext(recursiveCount + 1);
            }
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            this.currentQueueIndex = 0;
            // Skip unavailable tracks
            if (currentQueue[this.currentQueueIndex].isUnavailable) {
                return this.playNext(recursiveCount + 1);
            }
        } else {
            return;
        }

        this.playTrackFromQueue(0, recursiveCount);
    }

    playPrev(recursiveCount = 0) {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            this.updateMediaSessionPositionState();
        } else if (this.currentQueueIndex > 0) {
            this.currentQueueIndex--;
            // Skip unavailable tracks
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

            if (recursiveCount > currentQueue.length) {
                console.error('All tracks in queue are unavailable.');
                this.audio.pause();
                return;
            }

            if (currentQueue[this.currentQueueIndex].isUnavailable) {
                return this.playPrev(recursiveCount + 1);
            }
            this.playTrackFromQueue(0, recursiveCount);
        }
    }

    handlePlayPause() {
        if (!this.audio.src || this.audio.error) {
            if (this.currentTrack) {
                this.playTrackFromQueue(0, 0);
            }
            return;
        }

        if (this.audio.paused) {
            this.audio.play().catch((e) => {
                if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
                console.error('Play failed, reloading track:', e);
                if (this.currentTrack) {
                    this.playTrackFromQueue(0, 0);
                }
            });
        } else {
            this.audio.pause();
            this.saveQueueState();
        }
    }

    seekBackward(seconds = 10) {
        const newTime = Math.max(0, this.audio.currentTime - seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    seekForward(seconds = 10) {
        const duration = this.audio.duration || 0;
        const newTime = Math.min(duration, this.audio.currentTime + seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    toggleShuffle() {
        this.shuffleActive = !this.shuffleActive;

        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle = [...this.queue];
            const currentTrack = this.queue[this.currentQueueIndex];

            const tracksToShuffle = [...this.queue];
            if (currentTrack && this.currentQueueIndex >= 0) {
                tracksToShuffle.splice(this.currentQueueIndex, 1);
            }

            tracksToShuffle.sort(() => Math.random() - 0.5);

            if (currentTrack) {
                this.shuffledQueue = [currentTrack, ...tracksToShuffle];
                this.currentQueueIndex = 0;
            } else {
                this.shuffledQueue = tracksToShuffle;
                this.currentQueueIndex = -1;
            }
        } else {
            const currentTrack = this.shuffledQueue[this.currentQueueIndex];
            this.queue = [...this.originalQueueBeforeShuffle];
            this.currentQueueIndex = this.queue.findIndex((t) => t.id === currentTrack?.id);
        }

        this.preloadCache.clear();
        this.preloadNextTracks();
        this.saveQueueState();
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        this.saveQueueState();
        return this.repeatMode;
    }

    setQueue(tracks, startIndex = 0) {
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.preloadCache.clear();
        this.saveQueueState();
        // Start preloading the upcoming tracks immediately
        try { this.preloadNextTracks(); } catch (e) {}
    }

    addToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        this.queue.push(...tracks);

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.queue.length - tracks.length;
            this.playTrackFromQueue(0, 0);
        }
        this.saveQueueState();
        // If we're not currently playing the new items, warm upcoming resources
        try { this.preloadNextTracks(); } catch (e) {}
    }

    addNextToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const insertIndex = this.currentQueueIndex + 1;

        // Insert after current track
        currentQueue.splice(insertIndex, 0, ...tracks);

        // If we are shuffling, we might want to also add it to the original queue for consistency,
        // though syncing that is tricky. The standard logic often just appends to the active queue view.
        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle.push(...tracks); // Sync original queue
        }

        this.saveQueueState();
        this.preloadNextTracks(); // Update preload since next track changed
    }

    removeFromQueue(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        // If removing current track
        if (index === this.currentQueueIndex) {
            // If playing, we might want to stop or just let it finish?
            // For now, let's just remove it.
            // If it's the last track, playback will stop naturally or we handle it?
        }

        if (index < this.currentQueueIndex) {
            this.currentQueueIndex--;
        }

        const removedTrack = currentQueue.splice(index, 1)[0];

        if (this.shuffleActive) {
            // Also remove from original queue
            const originalIndex = this.originalQueueBeforeShuffle.findIndex((t) => t.id === removedTrack.id); // Simple ID check
            if (originalIndex !== -1) {
                this.originalQueueBeforeShuffle.splice(originalIndex, 1);
            }
        }

        this.saveQueueState();
        this.preloadNextTracks();
    }

    clearQueue() {
        if (this.currentTrack) {
            this.queue = [this.currentTrack];

            if (this.shuffleActive) {
                this.shuffledQueue = [this.currentTrack];
                this.originalQueueBeforeShuffle = [this.currentTrack];
            } else {
                this.shuffledQueue = [];
                this.originalQueueBeforeShuffle = [];
            }
            this.currentQueueIndex = 0;
        } else {
            this.queue = [];
            this.shuffledQueue = [];
            this.originalQueueBeforeShuffle = [];
            this.currentQueueIndex = -1;
        }

        this.preloadCache.clear();
        this.saveQueueState();
    }

    moveInQueue(fromIndex, toIndex) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        if (fromIndex < 0 || fromIndex >= currentQueue.length) return;
        if (toIndex < 0 || toIndex >= currentQueue.length) return;

        const [track] = currentQueue.splice(fromIndex, 1);
        currentQueue.splice(toIndex, 0, track);

        if (this.currentQueueIndex === fromIndex) {
            this.currentQueueIndex = toIndex;
        } else if (fromIndex < this.currentQueueIndex && toIndex >= this.currentQueueIndex) {
            this.currentQueueIndex--;
        } else if (fromIndex > this.currentQueueIndex && toIndex <= this.currentQueueIndex) {
            this.currentQueueIndex++;
        }
        this.saveQueueState();
    }

    getCurrentQueue() {
        return this.shuffleActive ? this.shuffledQueue : this.queue;
    }

    getNextTrack() {
        const currentQueue = this.getCurrentQueue();
        if (this.currentQueueIndex === -1 || currentQueue.length === 0) return null;

        const nextIndex = this.currentQueueIndex + 1;
        if (nextIndex < currentQueue.length) {
            return currentQueue[nextIndex];
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            return currentQueue[0];
        }
        return null;
    }

    updatePlayingTrackIndicator() {
        const currentTrack = this.getCurrentQueue()[this.currentQueueIndex];
        document.querySelectorAll('.track-item').forEach((item) => {
            item.classList.toggle('playing', currentTrack && item.dataset.trackId == currentTrack.id);
        });

        document.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);
            item.classList.toggle('playing', index === this.currentQueueIndex);
        });
    }

    updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;

        // Force a refresh for picky Bluetooth systems by clearing metadata first
        navigator.mediaSession.metadata = null;

        const artwork = [];
        const sizes = ['320'];
        const coverId = track.album?.cover;
        const trackTitle = getTrackTitle(track);

        if (coverId) {
            sizes.forEach((size) => {
                artwork.push({
                    src: this.api.getCoverUrl(coverId, size),
                    sizes: `${size}x${size}`,
                    type: 'image/jpeg',
                });
            });
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackTitle || 'Unknown Title',
            artist: getTrackArtists(track) || 'Unknown Artist',
            album: track.album?.title || 'Unknown Album',
            artwork: artwork.length > 0 ? artwork : undefined,
        });

        this.updateMediaSessionPlaybackState();
        this.updateMediaSessionPositionState();
    }

    updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    }

    updateMediaSessionPositionState() {
        if (!('mediaSession' in navigator)) return;
        if (!('setPositionState' in navigator.mediaSession)) return;

        const duration = this.audio.duration;

        if (!duration || isNaN(duration) || !isFinite(duration)) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: this.audio.playbackRate || 1,
                position: Math.min(this.audio.currentTime, duration),
            });
        } catch (error) {
            console.log('Failed to update Media Session position:', error);
        }
    }

    // Sleep Timer Methods
    setSleepTimer(minutes) {
        this.clearSleepTimer(); // Clear any existing timer

        this.sleepTimerEndTime = Date.now() + minutes * 60 * 1000;

        this.sleepTimer = setTimeout(
            () => {
                this.audio.pause();
                this.clearSleepTimer();
                this.updateSleepTimerUI();
            },
            minutes * 60 * 1000
        );

        // Update UI every second
        this.sleepTimerInterval = setInterval(() => {
            this.updateSleepTimerUI();
        }, 1000);

        this.updateSleepTimerUI();
    }

    clearSleepTimer() {
        if (this.sleepTimer) {
            clearTimeout(this.sleepTimer);
            this.sleepTimer = null;
        }
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.sleepTimerEndTime = null;
        this.updateSleepTimerUI();
    }

    getSleepTimerRemaining() {
        if (!this.sleepTimerEndTime) return null;
        const remaining = Math.max(0, this.sleepTimerEndTime - Date.now());
        return Math.ceil(remaining / 1000); // Return seconds remaining
    }

    isSleepTimerActive() {
        return this.sleepTimer !== null;
    }

    updateSleepTimerUI() {
        const timerBtn = document.getElementById('sleep-timer-btn');
        const timerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');

        const updateBtn = (btn) => {
            if (!btn) return;
            if (this.isSleepTimerActive()) {
                const remaining = this.getSleepTimerRemaining();
                if (remaining > 0) {
                    const minutes = Math.floor(remaining / 60);
                    const seconds = remaining % 60;
                    btn.innerHTML = `<span style="font-size: 12px; font-weight: bold;">${minutes}:${seconds.toString().padStart(2, '0')}</span>`;
                    btn.title = `Sleep Timer: ${minutes}:${seconds.toString().padStart(2, '0')} remaining`;
                    btn.classList.add('active');
                    btn.style.color = 'var(--primary)';
                } else {
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12,6 12,12 16,14"/>
                        </svg>
                    `;
                    btn.title = 'Sleep Timer';
                    btn.classList.remove('active');
                    btn.style.color = '';
                }
            } else {
                btn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                    </svg>
                `;
                btn.title = 'Sleep Timer';
                btn.classList.remove('active');
                btn.style.color = '';
            }
        };

        updateBtn(timerBtn);
        updateBtn(timerBtnDesktop);
    }
}
