/**
 * Brick Breaker - Endless Mode (Engine Perfected)
 *
 * Physics matched to original Java game:
 * - Ball uses 20x20 rectangular hitbox (rendered as oval)
 * - Paddle uses three-zone collision (left/center/right)
 * - Velocities scaled for 60 FPS (original was 125 FPS)
 * - Wall bounds match original (700x600 canvas)
 */

export class BrickBreaker {
    // Constants matching original Java game
    static CANVAS_WIDTH = 700;
    static CANVAS_HEIGHT = 600;
    static PADDLE_WIDTH = 100;
    static PADDLE_HEIGHT = 8;
    static PADDLE_Y = 550;
    static BALL_SIZE = 20;
    static BRICK_OFFSET_X = 35;
    static BRICK_OFFSET_Y = 50;

    constructor(canvas, onScoreUpdate, onGameOver) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onScoreUpdate = onScoreUpdate;
        this.onGameOver = onGameOver;

        // Canvas dimensions (matching original)
        this.width = BrickBreaker.CANVAS_WIDTH;
        this.height = BrickBreaker.CANVAS_HEIGHT;
        canvas.width = this.width;
        canvas.height = this.height;

        // Game state
        this.score = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.gameOver = false;

        // Difficulty scaling
        this.level = 1;
        this.baseSpeed = 1; // Base multiplier for velocity scaling
        this.currentSpeed = 1;
        this.rowDropTimer = 0;
        this.rowDropInterval = 1500; // Drop new row every ~25 seconds at 60fps

        // Input recording for anti-cheat
        this.inputLog = [];
        this.frameCount = 0;
        this.gameStartTime = null;

        // Collision flag to prevent multiple paddle hits per frame
        this.paddleHitThisFrame = false;

        // Bind handlers for proper cleanup
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleTouch = this.handleTouch.bind(this);

        // Input state
        this.keys = { left: false, right: false };
        this.inputsBound = false;
    }

    initEntities() {
        // Paddle (matching original: 100x8 at y=550)
        this.paddle = {
            x: this.width / 2 - BrickBreaker.PADDLE_WIDTH / 2,
            y: BrickBreaker.PADDLE_Y,
            width: BrickBreaker.PADDLE_WIDTH,
            height: BrickBreaker.PADDLE_HEIGHT,
            speed: 40, // 20 * 2 for 60 FPS (original was 20 at 125 FPS)
            minWidth: 50
        };

        // Ball as rectangle (matching original: 20x20 at (120, 350))
        // Velocities scaled: original (-1, -2) at 125 FPS -> (-2, -4) at 60 FPS
        this.ball = {
            x: 120,
            y: 350,
            width: BrickBreaker.BALL_SIZE,
            height: BrickBreaker.BALL_SIZE,
            dx: -2,
            dy: -4
        };

        // Brick configuration
        this.brickRowCount = 5;
        this.brickColCount = 10;
        this.brickWidth = 62;
        this.brickHeight = 20;
        this.brickPadding = 4;
        this.brickOffsetTop = BrickBreaker.BRICK_OFFSET_Y;
        this.brickOffsetLeft = BrickBreaker.BRICK_OFFSET_X;

        // Initialize brick grid
        this.bricks = [];
        this.initBricks();
    }

    initBricks() {
        this.bricks = [];
        for (let row = 0; row < this.brickRowCount; row++) {
            this.bricks[row] = [];
            for (let col = 0; col < this.brickColCount; col++) {
                this.bricks[row][col] = {
                    x: col * (this.brickWidth + this.brickPadding) + this.brickOffsetLeft,
                    y: row * (this.brickHeight + this.brickPadding) + this.brickOffsetTop,
                    width: this.brickWidth,
                    height: this.brickHeight,
                    alive: true,
                    points: 10 + (this.brickRowCount - row - 1) * 5,
                    color: this.getBrickColor(row)
                };
            }
        }
    }

    getBrickColor(row) {
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd'];
        return colors[row % colors.length];
    }

    bindInputs() {
        if (this.inputsBound) return;

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
        this.canvas.addEventListener('touchmove', this.handleTouch, { passive: false });
        this.inputsBound = true;
    }

    handleKeyDown(e) {
        if (e.key === 'ArrowLeft' || e.key === 'a') {
            this.keys.left = true;
            this.logInput('left_down');
        }
        if (e.key === 'ArrowRight' || e.key === 'd') {
            this.keys.right = true;
            this.logInput('right_down');
        }
    }

    handleKeyUp(e) {
        if (e.key === 'ArrowLeft' || e.key === 'a') {
            this.keys.left = false;
            this.logInput('left_up');
        }
        if (e.key === 'ArrowRight' || e.key === 'd') {
            this.keys.right = false;
            this.logInput('right_up');
        }
    }

    handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const x = (touch.clientX - rect.left) * scaleX;

        // Center paddle on touch, with bounds clamping
        this.paddle.x = Math.max(0, Math.min(this.width - this.paddle.width, x - this.paddle.width / 2));
        this.logInput(`touch_${Math.round(x)}`);
    }

    logInput(action) {
        if (this.isPlaying && !this.gameOver) {
            this.inputLog.push({
                frame: this.frameCount,
                time: Date.now() - this.gameStartTime,
                action: action
            });
        }
    }

    start() {
        // Reset game state
        this.isPlaying = true;
        this.gameOver = false;
        this.score = 0;
        this.level = 1;
        this.currentSpeed = this.baseSpeed;
        this.frameCount = 0;
        this.rowDropTimer = 0;
        this.inputLog = [];
        this.gameStartTime = Date.now();

        // Reset input state
        this.keys = { left: false, right: false };

        // Initialize game entities
        this.initEntities();

        // Bind inputs (only once)
        this.bindInputs();

        // Start game loop
        this.gameLoop();
    }

    gameLoop() {
        if (!this.isPlaying || this.gameOver) return;

        this.frameCount++;
        this.paddleHitThisFrame = false;
        this.update();
        this.render();

        requestAnimationFrame(() => this.gameLoop());
    }

    update() {
        if (this.isPaused) return;

        // Move paddle (scaled for 60 FPS)
        if (this.keys.left) {
            this.paddle.x -= this.paddle.speed;
        }
        if (this.keys.right) {
            this.paddle.x += this.paddle.speed;
        }

        // Clamp paddle position
        this.paddle.x = Math.max(0, Math.min(this.width - this.paddle.width, this.paddle.x));

        // Move ball
        this.ball.x += this.ball.dx * this.currentSpeed;
        this.ball.y += this.ball.dy * this.currentSpeed;

        // Wall collisions (matching original bounds)
        this.checkWallCollision();

        // Game over check (matching original: y > 570)
        if (this.ball.y > 570) {
            this.endGame();
            return;
        }

        // Paddle collision (three-zone logic)
        if (!this.paddleHitThisFrame) {
            this.checkPaddleCollision();
        }

        // Brick collisions
        this.checkBrickCollisions();

        // Endless mode: drop new rows periodically
        this.rowDropTimer++;
        if (this.rowDropTimer >= this.rowDropInterval) {
            this.dropNewRow();
            this.rowDropTimer = 0;
        }

        // Difficulty scaling
        this.updateDifficulty();
    }

    /**
     * Rectangle intersection check (matching original Java Rectangle.intersects)
     */
    intersects(r1, r2) {
        return r1.x < r2.x + r2.width &&
               r1.x + r1.width > r2.x &&
               r1.y < r2.y + r2.height &&
               r1.y + r1.height > r2.y;
    }

    /**
     * Wall collision (matching original bounds: x<0, x>670, y<0)
     */
    checkWallCollision() {
        // Left wall
        if (this.ball.x < 0) {
            this.ball.dx = -this.ball.dx;
            this.ball.x = 0;
        }
        // Right wall (700 - 20 = 680, but original uses 670)
        if (this.ball.x > 670) {
            this.ball.dx = -this.ball.dx;
            this.ball.x = 670;
        }
        // Top wall
        if (this.ball.y < 0) {
            this.ball.dy = -this.ball.dy;
            this.ball.y = 0;
        }
    }

    /**
     * Paddle collision with three zones (matching original Java logic)
     * Left zone (30px): bounce left
     * Center zone (40px): straight bounce
     * Right zone (30px): bounce right
     */
    checkPaddleCollision() {
        const ballRect = {
            x: this.ball.x,
            y: this.ball.y,
            width: this.ball.width,
            height: this.ball.height
        };

        const paddleY = this.paddle.y;
        const paddleX = this.paddle.x;

        // Scale zones based on paddle width (original: 30-40-30 for 100px paddle)
        const zoneRatio = this.paddle.width / 100;
        const leftZone = 30 * zoneRatio;
        const centerZone = 40 * zoneRatio;
        const rightZone = 30 * zoneRatio;

        // Left zone - bounce left
        const leftRect = { x: paddleX, y: paddleY, width: leftZone, height: this.paddle.height };
        if (this.intersects(ballRect, leftRect)) {
            this.ball.dy = -Math.abs(this.ball.dy); // Always go up
            this.ball.dx = -4; // Go left (scaled for 60 FPS, original: -2)
            this.ball.y = paddleY - this.ball.height; // Move above paddle
            this.paddleHitThisFrame = true;
            return;
        }

        // Right zone - bounce right
        const rightRect = { x: paddleX + leftZone + centerZone, y: paddleY, width: rightZone, height: this.paddle.height };
        if (this.intersects(ballRect, rightRect)) {
            this.ball.dy = -Math.abs(this.ball.dy); // Always go up
            this.ball.dx = 4; // Go right (scaled for 60 FPS)
            this.ball.y = paddleY - this.ball.height;
            this.paddleHitThisFrame = true;
            return;
        }

        // Center zone - straight bounce
        const centerRect = { x: paddleX + leftZone, y: paddleY, width: centerZone, height: this.paddle.height };
        if (this.intersects(ballRect, centerRect)) {
            this.ball.dy = -Math.abs(this.ball.dy); // Always go up
            // Keep dx mostly the same, slight variation
            this.ball.y = paddleY - this.ball.height;
            this.paddleHitThisFrame = true;
            return;
        }
    }

    /**
     * Brick collision detection (matching original Rectangle.intersects)
     */
    checkBrickCollisions() {
        const ballRect = {
            x: this.ball.x,
            y: this.ball.y,
            width: this.ball.width,
            height: this.ball.height
        };

        brickLoop:
        for (let row = 0; row < this.bricks.length; row++) {
            for (let col = 0; col < this.bricks[row].length; col++) {
                const brick = this.bricks[row][col];
                if (!brick.alive) continue;

                const brickRect = {
                    x: brick.x,
                    y: brick.y,
                    width: brick.width,
                    height: brick.height
                };

                if (this.intersects(ballRect, brickRect)) {
                    brick.alive = false;
                    this.score += brick.points;
                    this.onScoreUpdate(this.score);

                    // Determine collision side (matching original logic)
                    // Check if ball hit from side or top/bottom
                    if (this.ball.x + 19 <= brick.x || this.ball.x + 1 >= brick.x + brick.width) {
                        // Side hit
                        this.ball.dx = -this.ball.dx;
                    } else {
                        // Top/bottom hit
                        this.ball.dy = -this.ball.dy;
                    }

                    // Check if row is cleared for endless mode
                    this.checkRowCleared(row);

                    // Only one brick collision per frame (matching original labeled break)
                    break brickLoop;
                }
            }
        }
    }

    checkRowCleared(row) {
        if (row >= this.bricks.length) return;

        const rowCleared = this.bricks[row].every(brick => !brick.alive);
        if (rowCleared) {
            this.shiftBricksDown();
            this.addNewRowAtTop();
            this.level++;
        }
    }

    shiftBricksDown() {
        for (let row = 0; row < this.bricks.length; row++) {
            for (let col = 0; col < this.bricks[row].length; col++) {
                this.bricks[row][col].y += this.brickHeight + this.brickPadding;
            }
        }
    }

    addNewRowAtTop() {
        const newRow = [];
        for (let col = 0; col < this.brickColCount; col++) {
            newRow.push({
                x: col * (this.brickWidth + this.brickPadding) + this.brickOffsetLeft,
                y: this.brickOffsetTop,
                width: this.brickWidth,
                height: this.brickHeight,
                alive: true,
                points: 10 + this.level * 5,
                color: this.getBrickColor(this.level % 5)
            });
        }
        this.bricks.unshift(newRow);

        // Remove rows that are too low
        while (this.bricks.length > 0 && this.bricks[this.bricks.length - 1][0].y > this.paddle.y - 30) {
            this.bricks.pop();
        }
    }

    dropNewRow() {
        // Push all existing bricks down
        for (let row = 0; row < this.bricks.length; row++) {
            for (let col = 0; col < this.bricks[row].length; col++) {
                this.bricks[row][col].y += this.brickHeight + this.brickPadding;

                // Game over if bricks reach paddle level
                if (this.bricks[row][col].alive && this.bricks[row][col].y > this.paddle.y - 50) {
                    this.endGame();
                    return;
                }
            }
        }

        // Add new row at top
        const newRow = [];
        for (let col = 0; col < this.brickColCount; col++) {
            newRow.push({
                x: col * (this.brickWidth + this.brickPadding) + this.brickOffsetLeft,
                y: this.brickOffsetTop,
                width: this.brickWidth,
                height: this.brickHeight,
                alive: true,
                points: 10 + this.level * 5,
                color: this.getBrickColor(this.level % 5)
            });
        }
        this.bricks.unshift(newRow);

        // Limit brick rows
        if (this.bricks.length > 12) {
            this.bricks.pop();
        }
    }

    updateDifficulty() {
        // Speed up every 1000 points (subtle, gradual increase)
        const speedBonus = Math.floor(this.score / 1000) * 0.1;
        this.currentSpeed = Math.min(this.baseSpeed + speedBonus, this.baseSpeed * 2);

        // Shrink paddle every 1000 points (min 50px)
        const newPaddleWidth = BrickBreaker.PADDLE_WIDTH - Math.floor(this.score / 1000) * 10;
        this.paddle.width = Math.max(newPaddleWidth, this.paddle.minWidth);

        // Faster brick drops at higher scores
        this.rowDropInterval = Math.max(600, 1500 - Math.floor(this.score / 300) * 100);
    }

    endGame() {
        this.isPlaying = false;
        this.gameOver = true;

        const gameData = {
            score: this.score,
            level: this.level,
            duration: Date.now() - this.gameStartTime,
            inputLog: this.inputLog,
            frameCount: this.frameCount
        };

        this.onGameOver(gameData);
    }

    render() {
        // Clear canvas with background
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Draw bricks
        this.drawBricks();

        // Draw paddle (using fillRect for compatibility)
        this.drawPaddle();

        // Draw ball (oval visual, rectangular hitbox)
        this.drawBall();

        // Draw walls
        this.drawWalls();

        // Draw UI
        this.drawUI();
    }

    drawBricks() {
        for (let row = 0; row < this.bricks.length; row++) {
            for (let col = 0; col < this.bricks[row].length; col++) {
                const brick = this.bricks[row][col];
                if (brick.alive) {
                    this.ctx.fillStyle = brick.color;
                    this.ctx.fillRect(brick.x, brick.y, brick.width, brick.height);

                    // Brick border
                    this.ctx.strokeStyle = '#ffffff33';
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(brick.x, brick.y, brick.width, brick.height);
                }
            }
        }
    }

    drawPaddle() {
        this.ctx.fillStyle = '#00d9ff';
        this.ctx.fillRect(this.paddle.x, this.paddle.y, this.paddle.width, this.paddle.height);
    }

    drawBall() {
        // Ball rendered as oval but collision is rectangular 20x20
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.ellipse(
            this.ball.x + this.ball.width / 2,  // center x
            this.ball.y + this.ball.height / 2, // center y
            this.ball.width / 2,  // radius x
            this.ball.height / 2, // radius y
            0, 0, Math.PI * 2
        );
        this.ctx.fill();

        // Ball glow effect
        this.ctx.shadowColor = '#00d9ff';
        this.ctx.shadowBlur = 15;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
    }

    drawWalls() {
        this.ctx.fillStyle = '#00d9ff';
        this.ctx.fillRect(0, 0, 5, this.height);           // Left
        this.ctx.fillRect(this.width - 5, 0, 5, this.height); // Right
        this.ctx.fillRect(0, 0, this.width, 5);            // Top
    }

    drawUI() {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '14px Arial';
        this.ctx.fillText(`Level ${this.level}`, 10, 30);
        this.ctx.fillText(`Speed ${this.currentSpeed.toFixed(1)}x`, this.width - 80, 30);
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }

    destroy() {
        this.isPlaying = false;
        this.gameOver = true;

        // Remove event listeners to prevent memory leaks
        if (this.inputsBound) {
            document.removeEventListener('keydown', this.handleKeyDown);
            document.removeEventListener('keyup', this.handleKeyUp);
            this.canvas.removeEventListener('touchmove', this.handleTouch);
            this.inputsBound = false;
        }

        // Reset input state
        this.keys = { left: false, right: false };
    }
}

export default BrickBreaker;
