export function calcGridByDisplay(
    index: number,
    options: {
        rows: number;
        cols: number;
        screenWidth: number;   // 3840
        screenHeight: number;  // 2160
        displayScale: number;  // 1.5
    },
) {
    const {
        rows,
        cols,
        screenWidth,
        screenHeight,
        displayScale,
    } = options;

    // Logical resolution
    const logicalWidth = Math.floor(screenWidth / displayScale);
    const logicalHeight = Math.floor(screenHeight / displayScale);

    const winWidth = Math.floor(logicalWidth / cols);
    const winHeight = Math.floor(logicalHeight / rows);

    const col = index % cols;
    const row = Math.floor(index / cols);

    return {
        win_pos: `${col * winWidth},${row * winHeight}`,
        win_size: `${winWidth},${winHeight}`,
        win_scale: displayScale, // 🔥 QUAN TRỌNG NHẤT
    };
}
