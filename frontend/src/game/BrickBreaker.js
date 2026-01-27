/**
 * Brick Breaker - Endless Mode (2026 Edition)
 *
 * Premium game engine with:
 * - Frame-rate independent physics using delta time
 * - Smooth paddle movement with acceleration
 * - Precise angle-based ball bouncing
 * - Progressive difficulty scaling
 * - Anti-cheat input logging
 */

export class BrickBreaker {
    // Canvas dimensions
    static CANVAS_WIDTH = 700;
    static CANVAS_HEIGHT = 600;

    // Paddle constants (speed reduced 20% from 40 to 32)
    static PADDLE_WIDTH = 100;
    static PADDLE_HEIGHT = 10;
    static PADDLE_Y = 560;
    static PADDLE_BASE_SPEED = 8;      // pixels per frame at 60fps (was 40, now smooth)
    static PADDLE_MIN_WIDTH = 60;

    // Ball constants
    static BALL_RADIUS = 10;
    static BALL_BASE_SPEED = 6;        // pixels per frame at 60fps
    static BALL_MAX_SPEED = 12;

    // Brick constants
    static BRICK_ROWS = 5;
    static BRICK_COLS = 10;
    static BRICK_WIDTH = 62;
    static BRICK_HEIGHT = 22;
    static BRICK_PADDING = 4;
    static BRICK_OFFSET_TOP = 50;
    static BRICK_OFFSET_LEFT = 35;

    constructor(canvas, onScoreUpdate, onGameOver) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onScoreUpdate = onScoreUpdate;
        this.onGameOver = onGameOver;

        // Set canvas size
        this.width = BrickBreaker.CANVAS_WIDTH;
        this.height = BrickBreaker.CANVAS_HEIGHT;
        canvas.width = this.width;
        canvas.height = this.height;

        // Timing for frame-rate independence
        this.lastTime = 0;
        this.targetFPS = 60;
        this.targetFrameTime = 1000 / this.targetFPS;

        // Game state
        this.score = 0;
        this.level = 1;
        this.isPlaying = false;
        this.isPaused = false;
        this.gameOver = false;

        // Difficulty progression
        this.difficultyMultiplier = 1.0;
        this.rowDropTimer = 0;
        this.rowDropInterval = 1800; // frames until new row drops (~30 sec at 60fps)

        // Anti-cheat
        this.inputLog = [];
        this.frameCount = 0;
        this.gameStartTime = null;

        // Input handling
        this.keys = { left: false, right: false };
        this.inputsBound = false;

        // Bind methods
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleTouch = this.handleTouch.bind(this);
        this.gameLoop = this.gameLoop.bind(this);
    }

    /**
     * Initialize all game entities
     */
    initEntities() {
        // Paddle - centered at bottom
        this.paddle = {
            x: this.width / 2 - BrickBreaker.PADDLE_WIDTH / 2,
            y: BrickBreaker.PADDLE_Y,
            width: BrickBreaker.PADDLE_WIDTH,
            height: BrickBreaker.PADDLE_HEIGHT,
            speed: BrickBreaker.PADDLE_BASE_SPEED,
            velocity: 0,           // Current velocity for smooth movement
            acceleration: 0.8,     // How fast paddle accelerates
            friction: 0.85,        // Deceleration when no input
            targetVelocity: 0
        };

        // Ball - starts above paddle, moving up-left
        const startAngle = -Math.PI / 4 + (Math.random() - 0.5) * 0.5; // Slight random variation
        this.ball = {
            x: this.width / 2,
            y: BrickBreaker.PADDLE_Y - 30,
            radius: BrickBreaker.BALL_RADIUS,
            speed: BrickBreaker.BALL_BASE_SPEED,
            dx: Math.cos(startAngle) * BrickBreaker.BALL_BASE_SPEED,
            dy: -Math.abs(Math.sin(startAngle) * BrickBreaker.BALL_BASE_SPEED) // Always start going up
        };

        // Initialize bricks
        this.bricks = [];
        this.initBricks();
    }

    /**
     * Create the brick grid
     */
    initBricks() {
        this.bricks = [];
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd'];

        for (let row = 0; row < BrickBreaker.BRICK_ROWS; row++) {
            this.bricks[row] = [];
            for (let col = 0; col < BrickBreaker.BRICK_COLS; col++) {
                this.bricks[row][col] = {
                    x: col * (BrickBreaker.BRICK_WIDTH + BrickBreaker.BRICK_PADDING) + BrickBreaker.BRICK_OFFSET_LEFT,
                    y: row * (BrickBreaker.BRICK_HEIGHT + BrickBreaker.BRICK_PADDING) + BrickBreaker.BRICK_OFFSET_TOP,
                    width: BrickBreaker.BRICK_WIDTH,
                    height: BrickBreaker.BRICK_HEIGHT,
                    alive: true,
                    points: (BrickBreaker.BRICK_ROWS - row) * 10, // Top rows worth more
                    color: colors[row % colors.length],
                    hitTime: 0 // For hit animation
                };
            }
        }
    }

    /**
     * Bind keyboard and touch inputs
     */
    bindInputs() {
        if (this.inputsBound) return;

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
        this.canvas.addEventListener('touchstart', this.handleTouch, { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouch, { passive: false });
        this.inputsBound = true;
    }

    handleKeyDown(e) {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            if (!this.keys.left) {
                this.keys.left = true;
                this.logInput('left_down');
            }
            e.preventDefault();
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            if (!this.keys.right) {
                this.keys.right = true;
                this.logInput('right_down');
            }
            e.preventDefault();
        }
    }

    handleKeyUp(e) {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            this.keys.left = false;
            this.logInput('left_up');
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            this.keys.right = false;
            this.logInput('right_up');
        }
    }

    handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const touchX = (touch.clientX - rect.left) * scaleX;

        // Move paddle toward touch position smoothly
        const paddleCenter = this.paddle.x + this.paddle.width / 2;
        const diff = touchX - paddleCenter;

        this.keys.left = diff < -10;
        this.keys.right = diff > 10;

        this.logInput(`touch_${Math.round(touchX)}`);
    }

    logInput(action) {
        if (this.isPlaying && !this.gameOver) {
            this.inputLog.push({
                frame: this.frameCount,
                t: Date.now() - this.gameStartTime,
                action
            });
        }
    }

    /**
     * Start or restart the game
     */
    start() {
        this.isPlaying = true;
        this.gameOver = false;
        this.isPaused = false;
        this.score = 0;
        this.level = 1;
        this.difficultyMultiplier = 1.0;
        this.frameCount = 0;
        this.rowDropTimer = 0;
        this.inputLog = [];
        this.gameStartTime = Date.now();
        this.lastTime = performance.now();

        this.keys = { left: false, right: false };

        this.initEntities();
        this.bindInputs();

        requestAnimationFrame(this.gameLoop);
    }

    /**
     * Main game loop with delta time
     */
    gameLoop(currentTime) {
        if (!this.isPlaying || this.gameOver) return;

        // Calculate delta time for frame-rate independence
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;

        // Normalize to target frame rate (1.0 = perfect 60fps)
        const deltaMultiplier = Math.min(deltaTime / this.targetFrameTime, 2.0);

        this.frameCount++;

        if (!this.isPaused) {
            this.update(deltaMultiplier);
        }

        this.render();

        requestAnimationFrame(this.gameLoop);
    }

    /**
     * Update game state
     */
    update(dt) {
        this.updatePaddle(dt);
        this.updateBall(dt);
        this.checkCollisions();
        this.updateDifficulty();

        // Endless mode: periodic row drops
        this.rowDropTimer += dt;
        if (this.rowDropTimer >= this.rowDropInterval) {
            this.dropNewRow();
            this.rowDropTimer = 0;
        }
    }

    /**
     * Smooth paddle movement with acceleration/friction
     */
    updatePaddle(dt) {
        const p = this.paddle;

        // Determine target velocity based on input
        if (this.keys.left && !this.keys.right) {
            p.targetVelocity = -p.speed * this.difficultyMultiplier;
        } else if (this.keys.right && !this.keys.left) {
            p.targetVelocity = p.speed * this.difficultyMultiplier;
        } else {
            p.targetVelocity = 0;
        }

        // Smooth acceleration toward target
        if (p.targetVelocity !== 0) {
            p.velocity += (p.targetVelocity - p.velocity) * p.acceleration * dt;
        } else {
            // Apply friction when no input
            p.velocity *= Math.pow(p.friction, dt);
            if (Math.abs(p.velocity) < 0.1) p.velocity = 0;
        }

        // Apply velocity
        p.x += p.velocity * dt;

        // Clamp to bounds
        p.x = Math.max(5, Math.min(this.width - p.width - 5, p.x));
    }

    /**
     * Update ball position
     */
    updateBall(dt) {
        const b = this.ball;

        // Apply velocity with difficulty scaling
        b.x += b.dx * dt * this.difficultyMultiplier;
        b.y += b.dy * dt * this.difficultyMultiplier;
    }

    /**
     * Check all collisions
     */
    checkCollisions() {
        this.checkWallCollision();
        this.checkPaddleCollision();
        this.checkBrickCollisions();
        this.checkGameOver();
    }

    /**
     * Wall collision detection
     */
    checkWallCollision() {
        const b = this.ball;
        const r = b.radius;

        // Left wall
        if (b.x - r <= 5) {
            b.x = 5 + r;
            b.dx = Math.abs(b.dx);
        }

        // Right wall
        if (b.x + r >= this.width - 5) {
            b.x = this.width - 5 - r;
            b.dx = -Math.abs(b.dx);
        }

        // Top wall
        if (b.y - r <= 5) {
            b.y = 5 + r;
            b.dy = Math.abs(b.dy);
        }
    }

    /**
     * Paddle collision with angle-based bounce
     */
    checkPaddleCollision() {
        const b = this.ball;
        const p = this.paddle;

        // Only check if ball is moving down and near paddle height
        if (b.dy <= 0) return;
        if (b.y + b.radius < p.y || b.y - b.radius > p.y + p.height) return;

        // Check horizontal overlap
        if (b.x + b.radius >= p.x && b.x - b.radius <= p.x + p.width) {
            // Calculate hit position (-1 to 1, left to right)
            const hitPos = (b.x - (p.x + p.width / 2)) / (p.width / 2);

            // Calculate bounce angle (-60 to 60 degrees from vertical)
            const maxAngle = Math.PI / 3; // 60 degrees
            const angle = hitPos * maxAngle;

            // Maintain ball speed, change direction
            const speed = Math.sqrt(b.dx * b.dx + b.dy * b.dy);
            b.dx = Math.sin(angle) * speed;
            b.dy = -Math.abs(Math.cos(angle) * speed); // Always bounce up

            // Position ball above paddle to prevent sticking
            b.y = p.y - b.radius - 1;

            // Add slight speed boost on paddle hit (excitement factor)
            const newSpeed = Math.min(speed * 1.01, BrickBreaker.BALL_MAX_SPEED);
            const speedRatio = newSpeed / speed;
            b.dx *= speedRatio;
            b.dy *= speedRatio;
        }
    }

    /**
     * Brick collision detection
     */
    checkBrickCollisions() {
        const b = this.ball;

        for (let row = 0; row < this.bricks.length; row++) {
            for (let col = 0; col < this.bricks[row].length; col++) {
                const brick = this.bricks[row][col];
                if (!brick.alive) continue;

                // Circle-rectangle collision
                const closestX = Math.max(brick.x, Math.min(b.x, brick.x + brick.width));
                const closestY = Math.max(brick.y, Math.min(b.y, brick.y + brick.height));

                const distX = b.x - closestX;
                const distY = b.y - closestY;
                const distance = Math.sqrt(distX * distX + distY * distY);

                if (distance < b.radius) {
                    // Collision detected
                    brick.alive = false;
                    brick.hitTime = this.frameCount;

                    this.score += brick.points * this.level;
                    this.onScoreUpdate(this.score);

                    // Determine bounce direction based on collision side
                    const overlapX = b.radius - Math.abs(distX);
                    const overlapY = b.radius - Math.abs(distY);

                    if (overlapX < overlapY) {
                        // Side collision
                        b.dx = -b.dx;
                        b.x += (distX > 0 ? overlapX : -overlapX);
                    } else {
                        // Top/bottom collision
                        b.dy = -b.dy;
                        b.y += (distY > 0 ? overlapY : -overlapY);
                    }

                    // Check if row is cleared
                    if (this.bricks[row].every(br => !br.alive)) {
                        this.level++;
                        this.shiftBricksDown();
                        this.addNewRowAtTop();
                    }

                    return; // One collision per frame
                }
            }
        }
    }

    /**
     * Check if ball fell below paddle
     */
    checkGameOver() {
        if (this.ball.y - this.ball.radius > this.height) {
            this.endGame();
        }
    }

    /**
     * Shift all bricks down
     */
    shiftBricksDown() {
        const shiftAmount = BrickBreaker.BRICK_HEIGHT + BrickBreaker.BRICK_PADDING;
        for (let row = 0; row < this.bricks.length; row++) {
            for (let col = 0; col < this.bricks[row].length; col++) {
                this.bricks[row][col].y += shiftAmount;
            }
        }
    }

    /**
     * Add new row of bricks at top
     */
    addNewRowAtTop() {
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd'];
        const newRow = [];

        for (let col = 0; col < BrickBreaker.BRICK_COLS; col++) {
            newRow.push({
                x: col * (BrickBreaker.BRICK_WIDTH + BrickBreaker.BRICK_PADDING) + BrickBreaker.BRICK_OFFSET_LEFT,
                y: BrickBreaker.BRICK_OFFSET_TOP,
                width: BrickBreaker.BRICK_WIDTH,
                height: BrickBreaker.BRICK_HEIGHT,
                alive: true,
                points: 50 + this.level * 10,
                color: colors[this.level % colors.length],
                hitTime: 0
            });
        }

        this.bricks.unshift(newRow);

        // Remove rows that are too low (below paddle)
        this.bricks = this.bricks.filter(row => row[0].y < this.paddle.y - 30);
    }

    /**
     * Drop a new row from the top (endless mode pressure)
     */
    dropNewRow() {
        this.shiftBricksDown();
        this.addNewRowAtTop();

        // Check if bricks reached paddle level
        for (let row of this.bricks) {
            for (let brick of row) {
                if (brick.alive && brick.y + brick.height > this.paddle.y - 20) {
                    this.endGame();
                    return;
                }
            }
        }
    }

    /**
     * Progressive difficulty scaling
     */
    updateDifficulty() {
        // Gradual speed increase based on score (very subtle)
        // Every 500 points = 2% speed increase, max 50% increase
        const scoreBonus = Math.min(this.score / 500 * 0.02, 0.5);

        // Level bonus (each level = 3% speed increase)
        const levelBonus = (this.level - 1) * 0.03;

        this.difficultyMultiplier = 1.0 + scoreBonus + levelBonus;

        // Paddle shrinks gradually (min 60px)
        const shrinkAmount = Math.floor(this.score / 1000) * 5;
        this.paddle.width = Math.max(BrickBreaker.PADDLE_WIDTH - shrinkAmount, BrickBreaker.PADDLE_MIN_WIDTH);

        // Row drop interval decreases with score (faster pressure)
        this.rowDropInterval = Math.max(900, 1800 - Math.floor(this.score / 200) * 50);
    }

    /**
     * End the game
     */
    endGame() {
        this.isPlaying = false;
        this.gameOver = true;

        this.onGameOver({
            score: this.score,
            level: this.level,
            duration: Date.now() - this.gameStartTime,
            inputLog: this.inputLog,
            frameCount: this.frameCount
        });
    }

    /**
     * Render the game
     */
    render() {
        const ctx = this.ctx;

        // Clear with gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
        gradient.addColorStop(0, '#0f0f23');
        gradient.addColorStop(1, '#1a1a2e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.width, this.height);

        // Draw walls
        this.drawWalls();

        // Draw bricks
        this.drawBricks();

        // Draw paddle
        this.drawPaddle();

        // Draw ball
        this.drawBall();

        // Draw UI
        this.drawUI();
    }

    drawWalls() {
        const ctx = this.ctx;
        ctx.fillStyle = '#00d9ff';
        ctx.shadowColor = '#00d9ff';
        ctx.shadowBlur = 10;

        ctx.fillRect(0, 0, 5, this.height);           // Left
        ctx.fillRect(this.width - 5, 0, 5, this.height); // Right
        ctx.fillRect(0, 0, this.width, 5);            // Top

        ctx.shadowBlur = 0;
    }

    drawBricks() {
        const ctx = this.ctx;

        for (let row of this.bricks) {
            for (let brick of row) {
                if (!brick.alive) continue;

                // Brick fill with slight gradient
                const grad = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.height);
                grad.addColorStop(0, brick.color);
                grad.addColorStop(1, this.darkenColor(brick.color, 0.3));

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.roundRect(brick.x, brick.y, brick.width, brick.height, 3);
                ctx.fill();

                // Subtle border
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    drawPaddle() {
        const ctx = this.ctx;
        const p = this.paddle;

        // Paddle glow
        ctx.shadowColor = '#00d9ff';
        ctx.shadowBlur = 15;

        // Paddle gradient
        const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.height);
        grad.addColorStop(0, '#00d9ff');
        grad.addColorStop(1, '#0099cc');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, p.width, p.height, 4);
        ctx.fill();

        ctx.shadowBlur = 0;
    }

    drawBall() {
        const ctx = this.ctx;
        const b = this.ball;

        // Ball glow
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 20;

        // Ball gradient for 3D effect
        const grad = ctx.createRadialGradient(
            b.x - b.radius * 0.3, b.y - b.radius * 0.3, 0,
            b.x, b.y, b.radius
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.5, '#e0e0e0');
        grad.addColorStop(1, '#c0c0c0');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
    }

    drawUI() {
        const ctx = this.ctx;

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`Level ${this.level}`, 15, 28);

        ctx.textAlign = 'right';
        ctx.fillText(`${this.difficultyMultiplier.toFixed(2)}x`, this.width - 15, 28);
    }

    /**
     * Utility: Darken a hex color
     */
    darkenColor(hex, amount) {
        const num = parseInt(hex.slice(1), 16);
        const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
        const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(255 * amount));
        const b = Math.max(0, (num & 0x0000FF) - Math.round(255 * amount));
        return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
        this.lastTime = performance.now();
    }

    destroy() {
        this.isPlaying = false;
        this.gameOver = true;

        if (this.inputsBound) {
            document.removeEventListener('keydown', this.handleKeyDown);
            document.removeEventListener('keyup', this.handleKeyUp);
            this.canvas.removeEventListener('touchstart', this.handleTouch);
            this.canvas.removeEventListener('touchmove', this.handleTouch);
            this.inputsBound = false;
        }

        this.keys = { left: false, right: false };
    }
}

export default BrickBreaker;
