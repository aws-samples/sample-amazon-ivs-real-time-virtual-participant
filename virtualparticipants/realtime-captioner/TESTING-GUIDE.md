# Realtime Captioner - Testing Guide

## Current Status

The realtime-captioner virtual participant uses **on-device speech recognition (SODA)** with non-headless Chrome and Xvfb virtual display server to enable local processing in Docker containers.

## Architecture

### Components
1. **Xvfb** - Virtual X server (display :99) for non-headless Chrome
2. **PulseAudio** - Audio system for container audio support
3. **Chrome (non-headless)** - Required for SODA to work properly
4. **SODA** - Chrome's on-device Speech Recognition engine
5. **IVS Real-Time Stage** - Receives audio from remote participants
6. **SEI Messages** - Delivers captions to stage participants

### Why Non-Headless Chrome?

Testing revealed that SODA's voice activity detection doesn't work properly in headless Chrome within Docker containers:
- **Headless mode**: SODA receives audio but reports "No voiced samples" ❌
- **Non-headless mode with Xvfb**: SODA properly detects voice and generates captions ✅

## How It Works

### Startup Sequence
1. Supervisor starts Xvfb on display :99 (priority 10)
2. PulseAudio starts for audio support (priority 50)
3. Web server starts to serve the app (priority 100)
4. WebSocket server starts for VP communication (priority 150)
5. Puppeteer launches non-headless Chrome connected to Xvfb (priority 200)

### Runtime Flow
1. Virtual participant joins IVS Real-Time Stage
2. When remote participant speaks:
   - Audio track is captured from IVS stage
   - Passed to Web Speech API with `processLocally: true`
   - SODA processes audio locally (no internet required for transcription)
   - Transcription results are received
   - Captions are sent via SEI messages

### Expected Log Output

When working correctly, you should see:

```
[Xvfb] Starting X virtual framebuffer
[PulseAudio] Server startup complete
[SpeechRecognition] Language pack availability for en-US: true
[SpeechRecognition] Local processing (SODA) enabled for on-device recognition
[SpeechRecognition] Initialized successfully (local: true)
[SpeechRecognition] Starting recognition with audio track (kind: audio, enabled: true, readyState: live)
[Audio Monitor] Started audio level monitoring
[Audio Monitor] Avg: 128.0, Min: 90, Max: 165, Amplitude: 75 (128 = silence)
[SpeechRecognition] Interim result: "hello"
[SEI Caption] Sent partial caption (5 chars): "hello"
[SpeechRecognition] Final result: "hello world"
[SEI Caption] Sent final caption (11 chars): "hello world"
```

## Testing Steps

### 1. Build the Container
```bash
# From project root
make build-realtime-captioner
```

### 2. Deploy to ECS
```bash
# Deploy the stack
npm run deploy
```

### 3. Invite the Captioner to a Stage
```bash
# Use the invite script
npm run invite-vp -- --type realtime-captioner --stage-arn <your-stage-arn>
```

### 4. Monitor Logs
```bash
# Watch ECS task logs in CloudWatch
# Look for the log patterns mentioned above
```

### 5. Test with Audio
- Join the stage with another participant
- Speak into your microphone
- Watch for caption SEI messages in the logs

## Debugging

### If No Captions Appear

1. **Check Xvfb Status**
   - Look for: `[Xvfb] Starting X virtual framebuffer`
   - Verify DISPLAY environment variable is set to `:99`

2. **Check Audio Input**
   - Look for: `[Audio Monitor] Amplitude: X`
   - If amplitude is always 0, audio isn't reaching the container
   - If amplitude varies (e.g., 37-141), audio is present

3. **Check Speech Recognition Status**
   - Look for: `[SpeechRecognition] Initialized successfully (local: true)`
   - Should see: `Local processing (SODA) enabled`
   - Should NOT see: `local: false`

4. **Check Language Pack**
   - Look for: `[SpeechRecognition] Language pack availability for en-US: true`
   - If false, look for: `Language pack installation initiated`

5. **Check for Errors**
   - Look for: `[SpeechRecognition] Error:`
   - Common errors:
     - `no-speech`: No speech detected (may need to speak louder/clearer)
     - `audio-capture`: Audio capture failed
     - `not-allowed`: Permission denied (shouldn't happen in container)
     - `language-not-supported`: Language pack not installed

6. **Check Stage Connection**
   - Look for: `[SEI Caption] Stage not connected or not publishing`
   - Ensure stage is fully connected before speaking

### Chrome Launch Issues

If Chrome fails to start:
- Check Xvfb is running: Look for Xvfb process in logs
- Verify DISPLAY=:99 is set
- Check Chrome flags in pptr.ts include `--enable-features=SpeechRecognition,SODA`

## Configuration

### Environment Variables
- `DISPLAY=:99` - X server display for non-headless Chrome
- `PULSE_SERVER=unix:/tmp/pulse-socket` - PulseAudio socket
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome` - Chrome binary path

### Chrome Flags (pptr.ts)
- `headless: false` - Required for SODA to work properly
- `--enable-features=SpeechRecognition,SODA` - Enable speech recognition features
- `--use-fake-ui-for-media-stream` - Auto-grant media permissions
- `--enable-speech-dispatcher` - Enable speech dispatcher

### Supervisor Configuration
Programs start in this order:
1. Xvfb (priority 10)
2. PulseAudio (priority 50)
3. Web server (priority 100)
4. WebSocket server (priority 150)
5. Puppeteer/Chrome (priority 200)

## Known Limitations

1. **Display Requirement**: Requires Xvfb virtual display (adds ~50MB to container)
2. **Memory Usage**: Non-headless Chrome uses more memory than headless
3. **Language Support**: Currently configured for `en-US` only
4. **First-Time Delay**: Language pack download may cause initial delay

## Advantages of Local Processing

| Feature | Local (SODA) | Cloud (Google) |
|---------|--------------|----------------|
| Works on Mac | ✅ Yes | ✅ Yes |
| Works in Docker (headless) | ❌ No | ✅ Yes |
| Works in Docker (non-headless + Xvfb) | ✅ Yes | ✅ Yes |
| Latency | Lower | Higher |
| Internet Required | No (after language pack download) | Yes |
| Cost | Free | May incur costs |
| Privacy | Data stays local | Data sent to Google |

## Success Criteria

The captioner is working correctly when:
- ✅ Xvfb starts successfully
- ✅ Container starts without errors
- ✅ Speech Recognition initializes with `local: true`
- ✅ Language pack is available or successfully installed
- ✅ Audio monitoring shows non-zero amplitude when someone speaks
- ✅ Interim results appear in logs
- ✅ Final results appear in logs
- ✅ SEI caption messages are sent successfully
- ✅ Captions appear in the client application

## Troubleshooting

### Container Exits Immediately
- Check supervisor logs for which process failed
- Verify Xvfb can start (may need additional X11 packages)
- Check Chrome can connect to display :99

### "No voiced samples" Error
- This indicates SODA is receiving audio but not detecting voice
- Verify Chrome is running in non-headless mode
- Check DISPLAY environment variable is set
- Ensure Xvfb is running before Chrome starts

### Language Pack Issues
- First run may take longer as language pack downloads
- Check internet connectivity from container
- Verify Chrome has write access to language pack directory

## Support

If issues persist:
1. Check CloudWatch logs for the ECS task
2. Verify Xvfb is running: Look for Xvfb process logs
3. Confirm DISPLAY=:99 environment variable is set
4. Review the audio monitoring output to confirm audio is being received
5. Check Chrome is running in non-headless mode with SODA features enabled