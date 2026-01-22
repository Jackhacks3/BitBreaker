# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

**Manual compilation (without Ant/NetBeans):**
```bash
cd src
javac *.java
java Main
```

**With Apache Ant:**
```bash
ant clean
ant compile
ant run
ant jar          # Creates dist/brickbreaker.jar
```

**Run the JAR:**
```bash
java -jar dist/brickbreaker.jar
```

## Architecture

This is a classic Breakout/Brick Breaker game built with Java Swing. The codebase has three classes with no external dependencies.

### Class Responsibilities

- **Main** - Creates JFrame window (700x600), adds Gameplay panel, configures window properties
- **Gameplay** - Core game loop using Swing Timer (8ms delay). Handles rendering, keyboard input (KeyListener), ball physics, paddle movement, and collision detection. Implements ActionListener for timer-driven updates.
- **MapGenerator** - Creates and renders the brick grid. Stores brick state in 2D int array (1=present, 0=destroyed). Calculates brick dimensions based on grid size.

### Game Constants

- Window: 700x600 pixels
- Paddle: 100x8 pixels, moves 20px per keypress
- Ball: 20x20 pixels, initial velocity (-1, -2)
- Initial brick grid: 4 rows × 12 columns (48 bricks)
- Restart grid: 3 rows × 7 columns (21 bricks)
- Points per brick: 5

### Controls

- Left/Right arrow keys: Move paddle
- Enter: Start game / Restart after game over

### Collision Detection

Ball-paddle collision uses three zones (left 30px, center 40px, right 30px) to vary ball direction. Brick collision uses Rectangle.intersects() with labeled break statement for early exit.

## Project Configuration

- Java version: 1.8 (source and target)
- Main class: `Main`
- Output JAR: `dist/brickbreaker.jar`
- Build system: Apache Ant with NetBeans project files
