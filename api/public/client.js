class MatchmakingClient {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.currentGameId = null;
    this.inQueue = false;
    this.playerName = null;
    this.gameMode = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Connection buttons
    document.getElementById('connectBtn').addEventListener('click', () => this.connect());
    document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnect());
    
    // Player setup
    document.getElementById('createPlayerBtn').addEventListener('click', () => this.createPlayer());
    
    // Queue management
    document.getElementById('joinQueueBtn').addEventListener('click', () => this.joinQueue());
    document.getElementById('leaveQueueBtn').addEventListener('click', () => this.leaveQueue());
    
    // Game actions
    document.getElementById('sendActionBtn').addEventListener('click', () => this.sendTestAction());
    
    // Utility
    document.getElementById('clearLogBtn').addEventListener('click', () => this.clearLog());
    
    // Input validation
    document.getElementById('playerName').addEventListener('input', (e) => {
      this.validatePlayerName(e.target.value);
    });
  }

  connect() {
    this.log('🔄 Connecting to server...', 'info');
    
    try {
      this.socket = io();

      this.socket.on('connect', () => {
        this.log('✅ Connected to server successfully', 'success');
        this.updateConnectionStatus('connected');
      });

      this.socket.on('disconnect', (reason) => {
        this.log(`❌ Disconnected from server: ${reason}`, 'error');
        this.updateConnectionStatus('disconnected');
        this.resetGameState();
      });

      this.socket.on('connect_error', (error) => {
        this.log(`❌ Connection failed: ${error.message}`, 'error');
        this.updateConnectionStatus('disconnected');
      });

      this.socket.on('queue_joined', (data) => {
        this.log(`📍 Successfully joined ${data.gameMode.toUpperCase()} queue`, 'success');
        this.inQueue = true;
        this.updateQueueStatus('queue');
      });

      this.socket.on('queue_left', () => {
        this.log('📤 Left matchmaking queue', 'info');
        this.inQueue = false;
        this.updateQueueStatus('idle');
      });

      this.socket.on('match_found', (data) => {
        this.log(`🎉 Match found! Game ID: ${data.gameId}`, 'success');
        this.log(`👥 Players: ${data.players.map(p => p.username).join(', ')}`, 'info');
        this.currentGameId = data.gameId;
        document.getElementById('gameId').value = data.gameId;
        this.inQueue = false;
        this.updateQueueStatus('in-game');
      });

      this.socket.on('game_update', (data) => {
        this.log(`🎮 Game update received`, 'info');
        this.log(`📊 Data: ${JSON.stringify(data, null, 2)}`, 'data');
      });

      this.socket.on('player_joined', (data) => {
        this.log(`👤 Player joined: ${data.username}`, 'info');
      });

      this.socket.on('player_left', (data) => {
        this.log(`👋 Player left: ${data.username}`, 'info');
      });

      this.socket.on('error', (error) => {
        this.log(`❌ Server error: ${error.message}`, 'error');
      });

    } catch (error) {
      this.log(`❌ Failed to initialize connection: ${error.message}`, 'error');
    }
  }

  disconnect() {
    if (this.socket) {
      this.log('🔄 Disconnecting from server...', 'info');
      this.socket.disconnect();
      this.socket = null;
      this.resetGameState();
    }
  }

  async createPlayer() {
    const playerName = document.getElementById('playerName').value.trim();
    const gameMode = document.getElementById('gameMode').value;

    if (!playerName) {
      this.log('❌ Please enter a valid player name', 'error');
      return;
    }

    if (playerName.length < 2) {
      this.log('❌ Player name must be at least 2 characters long', 'error');
      return;
    }

    this.log('🔄 Creating player profile...', 'info');

    try {
      const response = await fetch('/api/players', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          username: playerName, 
          gameMode,
          preferences: {
            region: 'us-east',
            skillLevel: 'intermediate'
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const player = await response.json();
      this.playerId = player.id;
      this.playerName = player.username;
      this.gameMode = gameMode;

      this.log(`👤 Player created successfully: ${player.username}`, 'success');
      this.log(`🆔 Player ID: ${player.id}`, 'info');
      
      // Show player info
      document.getElementById('playerId').textContent = player.id;
      document.getElementById('playerInfo').style.display = 'block';
      
      // Enable queue button
      document.getElementById('joinQueueBtn').disabled = false;
      
    } catch (error) {
      this.log(`❌ Failed to create player: ${error.message}`, 'error');
    }
  }

  joinQueue() {
    if (!this.socket) {
      this.log('❌ Not connected to server', 'error');
      return;
    }

    if (!this.playerId) {
      this.log('❌ Please create a player first', 'error');
      return;
    }

    const gameMode = document.getElementById('gameMode').value;
    this.log(`🔄 Joining ${gameMode.toUpperCase()} matchmaking queue...`, 'info');

    this.socket.emit('join_queue', {
      playerId: this.playerId,
      gameMode,
      preferences: { 
        region: 'us-east',
        maxLatency: 100,
        skillLevel: 'intermediate'
      }
    });
  }

  leaveQueue() {
    if (!this.socket) {
      this.log('❌ Not connected to server', 'error');
      return;
    }

    if (!this.playerId) {
      this.log('❌ No active player', 'error');
      return;
    }

    const gameMode = document.getElementById('gameMode').value;
    this.log('🔄 Leaving matchmaking queue...', 'info');

    this.socket.emit('leave_queue', {
      playerId: this.playerId,
      gameMode
    });
  }

  sendTestAction() {
    if (!this.socket) {
      this.log('❌ Not connected to server', 'error');
      return;
    }

    if (!this.currentGameId) {
      this.log('❌ No active game session', 'error');
      return;
    }

    const gameId = document.getElementById('gameId').value || this.currentGameId;
    const testAction = {
      gameId,
      playerId: this.playerId,
      action: 'position_update',
      payload: {
        position: { 
          x: Math.round(Math.random() * 1000), 
          y: Math.round(Math.random() * 1000) 
        },
        rotation: Math.round(Math.random() * 360),
        timestamp: Date.now()
      }
    };

    this.socket.emit('game_action', testAction);
    this.log('📡 Test action sent to game server', 'info');
    this.log(`📊 Action data: ${JSON.stringify(testAction.payload, null, 2)}`, 'data');
  }

  updateConnectionStatus(status) {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.className = `status-indicator ${status}`;
    
    const statusTexts = {
      connected: 'Connected',
      disconnected: 'Disconnected',
      connecting: 'Connecting...'
    };
    
    statusEl.textContent = statusTexts[status] || status;

    // Update button states
    document.getElementById('connectBtn').disabled = status === 'connected';
    document.getElementById('disconnectBtn').disabled = status === 'disconnected';
    document.getElementById('sendActionBtn').disabled = status === 'disconnected' || !this.currentGameId;
  }

  updateQueueStatus(status) {
    const statusEl = document.getElementById('queueStatus');
    statusEl.className = `status-indicator ${status}`;
    
    const statusTexts = {
      idle: 'Not in queue',
      queue: 'In queue - searching for match...',
      'in-game': 'In game session'
    };
    
    statusEl.textContent = statusTexts[status] || status;

    // Update button states
    const isInQueue = status === 'queue';
    const isInGame = status === 'in-game';
    
    document.getElementById('joinQueueBtn').disabled = isInQueue || !this.playerId || !this.socket;
    document.getElementById('leaveQueueBtn').disabled = !isInQueue;
    document.getElementById('sendActionBtn').disabled = !isInGame || !this.socket;
  }

  resetGameState() {
    this.inQueue = false;
    this.currentGameId = null;
    document.getElementById('gameId').value = '';
    this.updateQueueStatus('idle');
  }

  validatePlayerName(name) {
    const createBtn = document.getElementById('createPlayerBtn');
    const isValid = name.trim().length >= 2;
    createBtn.disabled = !isValid;
    
    if (!isValid && name.length > 0) {
      this.log('⚠️ Player name must be at least 2 characters', 'warning');
    }
  }

  log(message, type = 'info') {
    const logEl = document.getElementById('log');
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    // Add color coding based on type
    let messageColor = '#e2e8f0';
    switch (type) {
      case 'success':
        messageColor = '#68d391';
        break;
      case 'error':
        messageColor = '#fc8181';
        break;
      case 'warning':
        messageColor = '#f6ad55';
        break;
      case 'data':
        messageColor = '#90cdf4';
        break;
      case 'info':
      default:
        messageColor = '#e2e8f0';
    }
    
    logEntry.innerHTML = `
      <span class="timestamp">[${timestamp}]</span>
      <span style="color: ${messageColor}">${message}</span>
    `;
    
    logEl.appendChild(logEntry);
    logEl.scrollTop = logEl.scrollHeight;
    
    // Keep log entries manageable (max 100 entries)
    const entries = logEl.querySelectorAll('.log-entry');
    if (entries.length > 100) {
      entries[0].remove();
    }
  }

  clearLog() {
    document.getElementById('log').innerHTML = '';
    this.log('📋 Activity log cleared', 'info');
  }
}

// Initialize the client when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.matchmakingClient = new MatchmakingClient();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (window.matchmakingClient && window.matchmakingClient.socket) {
    window.matchmakingClient.disconnect();
  }
});