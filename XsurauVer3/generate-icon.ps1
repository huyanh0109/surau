Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Clear with transparent background
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

# Dark Outer Fill
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 5, 22))
$g.FillEllipse($bgBrush, 8, 8, 240, 240)

# Magenta Outer Border Ring
$magentaPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 0, 160), 8)
$g.DrawEllipse($magentaPen, 12, 12, 232, 232)

# Cyan Inner Border Ring
$cyanPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 229, 255), 3)
$g.DrawEllipse($cyanPen, 24, 24, 208, 208)

# Center Infinity Loop Path
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddBezier(70, 128, 40, 90, 30, 166, 70, 166)
$path.AddBezier(70, 166, 110, 166, 146, 90, 186, 90)
$path.AddBezier(186, 90, 226, 90, 216, 166, 186, 166)
$path.AddBezier(186, 166, 146, 166, 110, 90, 70, 90)

$loopPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 0, 160), 16)
$loopPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$loopPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawPath($loopPen, $path)

$loopInnerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 240, 255), 7)
$loopInnerPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$loopInnerPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawPath($loopInnerPen, $path)

# Draw central 'L'
$lPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 10)
$lPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$lPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($lPen, 116, 95, 116, 155)
$g.DrawLine($lPen, 116, 155, 148, 155)

# Save PNG
$bmp.Save("K:\Surau\Loopy\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Create ICO
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream("K:\Surau\Loopy\icon.ico", [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$g.Dispose()
$bmp.Dispose()
Write-Output "Icon generated successfully!"
