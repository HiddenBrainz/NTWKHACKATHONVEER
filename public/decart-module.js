/**
 * Decart webcam integration module
 * This file is loaded dynamically when ENABLE_DECART=true
 *
 * To use:
 * 1. npm install @decartai/sdk
 * 2. Add DECART_API_KEY to .env
 * 3. Set ENABLE_DECART=true
 * 4. Import this module in app.js
 */

export class DecartModule {
  constructor(apiKey, camVideo, camPlaceholder) {
    this.apiKey = apiKey;
    this.camVideo = camVideo;
    this.camPlaceholder = camPlaceholder;
    this.client = null;
    this.realtimeClient = null;
    this.isActive = false;
  }

  /**
   * Initialize Decart and start webcam
   */
  async initialize() {
    try {
      console.log('[Decart] Initializing...');

      // Check for DecartClient in global scope
      if (typeof DecartClient === 'undefined') {
        throw new Error('DecartClient not loaded. Make sure to include @decartai/sdk in your HTML.');
      }

      // Get user media (webcam)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      console.log('[Decart] Webcam access granted');

      // Initialize Decart client
      this.client = new DecartClient(this.apiKey);

      // Connect realtime stream
      this.realtimeClient = await this.client.realtime.connect(stream, {
        model: 'lucy-2.1',
        prompt: 'professional presenter, clean background, neutral lighting',
        onRemoteStream: (remoteStream) => {
          console.log('[Decart] Remote stream received');
          this.handleRemoteStream(remoteStream);
        },
        onError: (error) => {
          console.error('[Decart] Stream error:', error);
          this.handleError(error);
        }
      });

      this.isActive = true;
      console.log('[Decart] Connected successfully');

      return true;
    } catch (error) {
      console.error('[Decart] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Handle incoming transformed stream
   */
  handleRemoteStream(remoteStream) {
    if (this.camVideo) {
      this.camVideo.srcObject = remoteStream;
      this.camVideo.classList.add('active');
    }

    if (this.camPlaceholder) {
      this.camPlaceholder.classList.add('hidden');
    }
  }

  /**
   * Handle errors
   */
  handleError(error) {
    console.error('[Decart] Error:', error);
    this.isActive = false;
  }

  /**
   * Set prompt for transformation
   */
  async setPrompt(prompt) {
    if (!this.realtimeClient || !this.isActive) {
      console.warn('[Decart] Cannot set prompt - client not active');
      return false;
    }

    try {
      await this.realtimeClient.setPrompt(prompt);
      console.log('[Decart] Prompt updated:', prompt);
      return true;
    } catch (error) {
      console.error('[Decart] Failed to set prompt:', error);
      return false;
    }
  }

  /**
   * Trigger breach transformation
   */
  async triggerBreachTransform() {
    return this.setPrompt(
      'datamosh glitch, cyberpunk compromised city, red alert, corrupted system, matrix code rain, digital corruption'
    );
  }

  /**
   * Reset to normal view
   */
  async resetTransform() {
    return this.setPrompt(
      'professional presenter, clean background, neutral lighting'
    );
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect() {
    if (this.realtimeClient) {
      try {
        await this.realtimeClient.disconnect();
        console.log('[Decart] Disconnected');
      } catch (error) {
        console.error('[Decart] Disconnect error:', error);
      }
    }

    this.isActive = false;
    this.client = null;
    this.realtimeClient = null;
  }
}

/**
 * Factory function to create and initialize Decart module
 */
export async function createDecartModule(apiKey, camVideo, camPlaceholder) {
  const module = new DecartModule(apiKey, camVideo, camPlaceholder);

  try {
    await module.initialize();
    return module;
  } catch (error) {
    console.error('[Decart] Module creation failed:', error);
    throw error;
  }
}
