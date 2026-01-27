# Brick Breaker Game Optimization Plan

## Progress Summary

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ COMPLETE | Core Rendering Improvements |
| 2 | ✅ COMPLETE | Input System Overhaul |
| 3 | ✅ COMPLETE | Physics Engine Upgrade |
| 4 | ✅ COMPLETE | Progressive Difficulty |
| 5 | ✅ COMPLETE | Deterministic Initial State |
| 6 | ⏳ Pending | Visual Polish |

---

## Phase 1: Core Rendering ✅ COMPLETE

### Changes Implemented

| Task | File:Line | Change |
|------|-----------|--------|
| Double buffering | `Gameplay.java:50` | Added `setDoubleBuffered(true)` |
| paintComponent | `Gameplay.java:59-60` | Replaced `paint()` with `paintComponent()` + `super.paintComponent(g)` |
| Anti-aliasing | `Gameplay.java:65-68` | Added 3 RenderingHints (antialias, rendering, text) |
| 120 FPS target | `Gameplay.java:22-23` | `TARGET_FPS=120`, `FRAME_DELAY=8ms` |
| Delta time | `Gameplay.java:131-137` | Calculate and cap deltaTime each frame |
| FPS display | `Gameplay.java:89-90` | Debug FPS counter in top-left |
| Removed dispose | `Gameplay.java:126` | Removed `g.dispose()` call |

### Code Diff Summary
```java
// BEFORE (Original)
private int delay = 8;
public void paint(Graphics g) {
    g.setColor(Color.black);
    ...
    g.dispose();
}

// AFTER (Phase 1)
private static final int TARGET_FPS = 120;
private static final int FRAME_DELAY = 1000 / TARGET_FPS;
private long lastFrameTime;
private double deltaTime = 0;

setDoubleBuffered(true);  // in constructor

protected void paintComponent(Graphics g) {
    super.paintComponent(g);
    Graphics2D g2d = (Graphics2D) g;
    g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, VALUE_ANTIALIAS_ON);
    g2d.setRenderingHint(RenderingHints.KEY_RENDERING, VALUE_RENDER_QUALITY);
    g2d.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, VALUE_TEXT_ANTIALIAS_ON);
    ...
    // No dispose() call
}
```

### Testing Notes
- FPS counter displays in top-left corner
- Verify no screen tearing during gameplay
- Text and shapes should appear smoother
- Original game logic preserved for comparison

---

## Phase 2: Input System Overhaul ✅ COMPLETE

### Changes Implemented

| Task | File:Line | Change |
|------|-----------|--------|
| Key state booleans | `Gameplay.java:34-36` | Added `leftPressed`, `rightPressed` |
| Float paddle position | `Gameplay.java:28` | `private double playerX = 310.0` |
| Paddle constants | `Gameplay.java:29-32` | `PADDLE_WIDTH`, `PADDLE_HEIGHT`, `PADDLE_Y`, `PADDLE_SPEED` |
| updatePaddle() method | `Gameplay.java:206-223` | Continuous movement with delta-time scaling |
| keyPressed() rewrite | `Gameplay.java:226-252` | State tracking + WASD + SPACE support |
| keyReleased() | `Gameplay.java:255-266` | Clear key states on release |
| restartGame() method | `Gameplay.java:272-285` | Centralized restart logic |

### Code Diff Summary
```java
// BEFORE (Original)
private int playerX = 310;
public void keyPressed(KeyEvent e) {
    if (e.getKeyCode() == KeyEvent.VK_RIGHT) {
        playerX += 20;  // Discrete jump
    }
}
public void keyReleased(KeyEvent e) {}  // Empty

// AFTER (Phase 2)
private double playerX = 310.0;
private boolean leftPressed = false;
private boolean rightPressed = false;

private void updatePaddle() {  // Called every frame
    double moveAmount = PADDLE_SPEED * deltaTime * TARGET_FPS;
    if (leftPressed) playerX -= moveAmount;
    if (rightPressed) playerX += moveAmount;
}

public void keyPressed(KeyEvent e) {
    if (key == VK_LEFT || key == VK_A) leftPressed = true;
    if (key == VK_RIGHT || key == VK_D) rightPressed = true;
}

public void keyReleased(KeyEvent e) {
    if (key == VK_LEFT || key == VK_A) leftPressed = false;
    if (key == VK_RIGHT || key == VK_D) rightPressed = false;
}
```

### Controls Now Supported
| Action | Keys |
|--------|------|
| Move Left | ← Arrow, A |
| Move Right | → Arrow, D |
| Start/Restart | Enter, Space |

### Testing Notes
- Hold left/right key: paddle should glide smoothly
- Release key: paddle stops immediately
- WASD and arrows work identically
- Moving paddle starts the game (original behavior preserved)

---

## Phase 3: Physics Engine Upgrade ✅ COMPLETE

### Changes Implemented

| Task | File:Line | Change |
|------|-----------|--------|
| Float ball position | `Gameplay.java:41-42` | `double ballX`, `double ballY` |
| Float ball velocity | `Gameplay.java:43-44` | `double ballVelX`, `double ballVelY` |
| Ball constants | `Gameplay.java:45-46` | `BALL_SIZE=20`, `BALL_SPEED=4.0` |
| `initBallVelocity()` | `Gameplay.java:71-75` | 45° angle initialization |
| `normalizeVelocity()` | `Gameplay.java:78-84` | Maintain consistent speed |
| `updateBall()` | `Gameplay.java:181-185` | Delta-time movement |
| `checkPaddleCollision()` | `Gameplay.java:188-214` | Angle-based bounce |
| `checkBrickCollisions()` | `Gameplay.java:217-280` | Overlap-based detection |
| `checkWallCollisions()` | `Gameplay.java:283-301` | Position correction |

### Code Diff Summary
```java
// BEFORE (Original)
private int ballposX = 120;
private int ballposY = 350;
private int ballXdir = -1;
private int ballYdir = -2;
ballposX += ballXdir;  // Integer movement

// Paddle collision (3 hardcoded zones)
if (ball.intersects(leftZone)) ballXdir = -2;
else if (ball.intersects(rightZone)) ballXdir += 1;

// AFTER (Phase 3)
private double ballX = 120.0;
private double ballY = 350.0;
private double ballVelX, ballVelY;
private static final double BALL_SPEED = 4.0;

// Delta-time movement
ballX += ballVelX * deltaTime * TARGET_FPS;

// Angle-based paddle collision
double hitPosition = (ballCenterX - paddleCenterX) / (PADDLE_WIDTH / 2.0);
double bounceAngle = hitPosition * (Math.PI / 3.0);  // Max 60°
ballVelX = BALL_SPEED * Math.sin(bounceAngle);
ballVelY = -BALL_SPEED * Math.cos(bounceAngle);

// Overlap-based brick collision
if (overlapX < overlapY) ballVelX = -ballVelX;  // Side hit
else ballVelY = -ballVelY;  // Top/bottom hit
```

### Physics Improvements

| Aspect | Before | After |
|--------|--------|-------|
| Ball position | Integer (1px precision) | Float (sub-pixel) |
| Ball velocity | Fixed (-1, -2) | Normalized vector |
| Paddle bounce | 3 discrete zones | Continuous angle |
| Brick bounce | Simple axis flip | Overlap detection |
| Movement | Frame-dependent | Delta-time scaled |
| Speed after bounce | Could drift | Always normalized |

### Testing Notes
- Speed display shows ~4.0 consistently
- Ball bounces at angles based on paddle hit position
- Hit left edge → ball goes left, hit right edge → ball goes right
- Brick collisions bounce correctly from sides vs top/bottom
- Ball speed remains constant throughout gameplay

---

## Phase 4: Progressive Difficulty ✅ COMPLETE

### Changes Implemented

| Task | File:Line | Change |
|------|-----------|--------|
| Level tracking | `Gameplay.java:24` | `private int level = 1` |
| Difficulty constants | `Gameplay.java:25-27` | `BASE_SPEED`, `SPEED_INCREMENT`, `POINTS_PER_LEVEL` |
| `getCurrentSpeed()` | `Gameplay.java:76-78` | Returns speed based on level |
| `checkLevelUp()` | `Gameplay.java:98-104` | Level up every 100 points |
| `levelComplete` state | `Gameplay.java:19` | Track level completion |
| `startNextLevel()` | `Gameplay.java:377-401` | Initialize next level |
| Level Complete screen | `Gameplay.java:148-159` | "Level X Complete!" overlay |
| Enhanced Game Over | `Gameplay.java:162-178` | Shows final score + level |
| HUD with Level | `Gameplay.java:128-132` | "Level: X" display |

### Speed Progression Table
| Level | Score Range | Ball Speed | Brick Rows |
|-------|-------------|------------|------------|
| 1 | 0-99 | 4.0 | 4 |
| 2 | 100-199 | 4.5 | 5 |
| 3 | 200-299 | 5.0 | 6 |
| 4 | 300-399 | 5.5 | 7 |
| 5+ | 400+ | 6.0+ | 8 (max) |

### Code Summary
```java
// Speed scaling
private double getCurrentSpeed() {
    return BASE_SPEED + (level - 1) * SPEED_INCREMENT;
}

// Level up check (called every frame)
private void checkLevelUp() {
    int newLevel = (score / POINTS_PER_LEVEL) + 1;
    if (newLevel > level) {
        level = newLevel;
        normalizeVelocity(); // Instantly apply new speed
    }
}

// Next level initialization
private void startNextLevel() {
    level++;
    int rows = Math.min(4 + (level - 1), 8); // More bricks each level
    map = new MapGenerator(rows, 12);
    initBallVelocity(); // Uses getCurrentSpeed()
}
```

### Testing Notes
- Level display shows in top-left
- Speed increases mid-game when crossing 100-point thresholds
- Clearing all bricks shows "Level X Complete!"
- Press Enter to start next level with more bricks and higher speed
- Game Over shows final score and level reached

---

## Phase 5: Deterministic Initial State ✅ COMPLETE

### Changes Implemented

| Task | File:Line | Change |
|------|-----------|--------|
| Initial constants | `Gameplay.java:18-25` | `INITIAL_ROWS`, `INITIAL_COLS`, `INITIAL_BALL_X/Y`, `INITIAL_PADDLE_X`, `INITIAL_BALL_ANGLE` |
| `initGame()` method | `Gameplay.java:86-110` | Centralized initialization using all constants |
| Constructor uses initGame | `Gameplay.java:78` | `initGame()` called instead of inline code |
| `restartGame()` uses initGame | `Gameplay.java:440-444` | Returns to EXACT initial state |
| `startNextLevel()` uses constants | `Gameplay.java:415-437` | Uses `INITIAL_*` for positioning |
| Start prompt added | `Gameplay.java:185-196` | Shows instructions before game starts |

### Deterministic Constants
```java
// ALL users start with these EXACT values
private static final int INITIAL_ROWS = 4;
private static final int INITIAL_COLS = 12;
private static final double INITIAL_BALL_X = 350.0;
private static final double INITIAL_BALL_Y = 400.0;
private static final double INITIAL_PADDLE_X = 300.0;
private static final double INITIAL_BALL_ANGLE = Math.PI / 4; // 45°
```

### Code Summary
```java
// Centralized initialization - guarantees identical state
private void initGame() {
    level = 1;
    score = 0;
    map = new MapGenerator(INITIAL_ROWS, INITIAL_COLS);
    totalBricks = INITIAL_ROWS * INITIAL_COLS;
    ballX = INITIAL_BALL_X;
    ballY = INITIAL_BALL_Y;
    initBallVelocity();  // Uses INITIAL_BALL_ANGLE
    playerX = INITIAL_PADDLE_X;
}

// Restart calls initGame() - no duplicate code
private void restartGame() {
    initGame();
    play = true;
}
```

### Testing Notes
- Every game start shows ball at (350, 400)
- Paddle always starts at X=300 (centered)
- Ball always goes up-left at 45°
- Restart returns to EXACT same state as initial load
- No random elements anywhere in game

---

## Phase 6: Visual Polish

### HUD Layout
```
Level: 1     Speed: 4.0     Score: 240
[FPS: 120]
```

### Game State Messages
- Start: "Press ENTER or SPACE to Start"
- Win: "LEVEL COMPLETE! Press ENTER for Level X"
- Lose: "GAME OVER | Final Score: X | Press ENTER"

### Visual Improvements
- Rounded paddle corners: `fillRoundRect(..., 5, 5)`
- Semi-transparent message overlays
- Cleaner Arial font throughout

---

## File Backup

Original preserved at:
- `src/Gameplay.java.backup`

To restore: `cp src/Gameplay.java.backup src/Gameplay.java`

---

## Execution Checklist

- [x] Phase 1: Core Rendering
  - [x] Double buffering enabled
  - [x] paintComponent() replacing paint()
  - [x] Anti-aliasing hints added
  - [x] 120 FPS timer configured
  - [x] Delta time calculated
  - [x] FPS display added
  - [x] g.dispose() removed
- [x] Phase 2: Input System
  - [x] Key state tracking (leftPressed/rightPressed)
  - [x] Continuous movement in game loop
  - [x] Delta-time scaled paddle speed
  - [x] WASD support added
  - [x] SPACE as alternate start key
  - [x] Float paddle position (double)
  - [x] Centralized restartGame() method
- [x] Phase 3: Physics Engine
  - [x] Float ball position (ballX, ballY)
  - [x] Float ball velocity (ballVelX, ballVelY)
  - [x] initBallVelocity() - 45° angle start
  - [x] normalizeVelocity() - consistent speed
  - [x] updateBall() - delta-time movement
  - [x] checkPaddleCollision() - angle-based bounce
  - [x] checkBrickCollisions() - overlap detection
  - [x] checkWallCollisions() - position correction
  - [x] Speed display in HUD
- [x] Phase 4: Progressive Difficulty
  - [x] Level tracking variable
  - [x] BASE_SPEED, SPEED_INCREMENT, POINTS_PER_LEVEL constants
  - [x] getCurrentSpeed() - level-based speed
  - [x] checkLevelUp() - level up every 100 points
  - [x] levelComplete state flag
  - [x] startNextLevel() - next level initialization
  - [x] Level Complete overlay screen
  - [x] Enhanced Game Over with score + level
  - [x] Level display in HUD
  - [x] More bricks per level (up to 8 rows)
- [x] Phase 5: Deterministic State
  - [x] INITIAL_ROWS, INITIAL_COLS constants
  - [x] INITIAL_BALL_X, INITIAL_BALL_Y constants
  - [x] INITIAL_PADDLE_X constant
  - [x] INITIAL_BALL_ANGLE constant
  - [x] Centralized initGame() method
  - [x] Constructor uses initGame()
  - [x] restartGame() uses initGame()
  - [x] startNextLevel() uses INITIAL_* constants
  - [x] Start prompt overlay added
  - [x] No random elements in game
- [ ] Phase 6: Visual Polish
- [ ] 


---

## Build & Test Commands

```bash
cd src
javac *.java
java Main
```

Watch for:
- FPS counter in top-left (should show ~120)
- No screen tearing
- Smoother text rendering
- Game logic unchanged from original

---

*Last Updated: Phase 5 Complete*
