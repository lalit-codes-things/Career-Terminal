# Repository Inventory Script
# This script scans the repository and catalogs all files

Write-Host "Starting repository inventory..." -ForegroundColor Green

# Define exclusions
$excludeDirs = @('.git', 'node_modules')
$excludePatterns = @('*.log', '*.tmp', '*.temp', '*.bak', '*.old')

# Function to get human-readable file size
function Get-FileSize {
    param([long]$bytes)
    if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
    elseif ($bytes -ge 1MB) { return "{0:N2} MB" -f ($bytes / 1MB) }
    elseif ($bytes -ge 1KB) { return "{0:N2} KB" -f ($bytes / 1KB) }
    else { return "$bytes B" }
}

# Collect all files
$allFiles = @()
$totalSize = 0
$fileCount = 0

Get-ChildItem -Path "." -Recurse -File | ForEach-Object {
    $skip = $false
    
    # Check if file is in excluded directory
    foreach ($excludeDir in $excludeDirs) {
        if ($_.FullName -match "\\$excludeDir\\") {
            $skip = $true
            break
        }
    }
    
    # Check if file matches exclude patterns
    if (-not $skip) {
        foreach ($pattern in $excludePatterns) {
            if ($_.Name -like $pattern) {
                $skip = $true
                break
            }
        }
    }
    
    if (-not $skip) {
        $fileInfo = [PSCustomObject]@{
            Path = $_.FullName
            Name = $_.Name
            Extension = $_.Extension
            SizeBytes = $_.Length
            SizeHuman = Get-FileSize $_.Length
            Directory = $_.DirectoryName
            LastWriteTime = $_.LastWriteTime
        }
        $allFiles += $fileInfo
        $totalSize += $_.Length
        $fileCount++
        
        # Progress indicator
        if ($fileCount % 100 -eq 0) {
            Write-Host "  Scanned $fileCount files..." -ForegroundColor Gray
        }
    }
}

# Analyze by extension
$byExtension = $allFiles | Group-Object Extension | ForEach-Object {
    $totalSize = ($_.Group | Measure-Object -Property SizeBytes -Sum).Sum
    [PSCustomObject]@{
        Extension = $_.Name
        Count = $_.Count
        TotalSizeBytes = $totalSize
        TotalSizeHuman = Get-FileSize $totalSize
    }
} | Sort-Object Count -Descending

# Analyze by directory
$byDirectory = $allFiles | Group-Object { $_.Directory } | ForEach-Object {
    $totalSize = ($_.Group | Measure-Object -Property SizeBytes -Sum).Sum
    [PSCustomObject]@{
        Directory = $_.Name
        Count = $_.Count
        TotalSizeBytes = $totalSize
        TotalSizeHuman = Get-FileSize $totalSize
    }
} | Sort-Object TotalSizeBytes -Descending

# Generate report
$report = @"
REPOSITORY INVENTORY REPORT
============================
Generated: $(Get-Date)
Total Files: $fileCount
Total Size: $(Get-FileSize $totalSize)

TOP 20 FILE EXTENSIONS:
$(($byExtension | Select-Object -First 20 | Format-Table -Property @{Name='Extension';Expression={$_.Extension}},@{Name='Count';Expression={$_.Count}},@{Name='Size';Expression={$_.TotalSizeHuman}} -AutoSize | Out-String))

TOP 20 LARGEST DIRECTORIES:
$(($byDirectory | Select-Object -First 20 | Format-Table -Property @{Name='Directory';Expression={$_.Directory}},@{Name='Count';Expression={$_.Count}},@{Name='Size';Expression={$_.TotalSizeHuman}} -AutoSize | Out-String))

FILE CATEGORIES:
1. Source Code Files (.ts, .js, .json, .yml, .yaml, .md, .prisma, .sql)
2. Configuration Files (.env, .eslintrc, .prettierrc, .gitignore, docker*)
3. Generated Artifacts (dist/, node_modules/, *.map, *.js in dist/)
4. Documentation (.md files)
5. Test Files (__tests__/, *.test.ts, *.spec.ts)
6. Build Files (Dockerfile*, docker-compose*, package*.json, tsconfig*)
7. Other Files
"@

# Save report
$report | Out-File -FilePath "inventory-report.txt" -Encoding UTF8

Write-Host "Inventory complete!" -ForegroundColor Green
Write-Host "Scanned $fileCount files" -ForegroundColor Cyan
Write-Host "Total size: $(Get-FileSize $totalSize)" -ForegroundColor Cyan
Write-Host "Report saved to inventory-report.txt" -ForegroundColor Green

# Show summary
Write-Host "`nTop 10 File Extensions:" -ForegroundColor Yellow
$byExtension | Select-Object -First 10 | Format-Table -Property @{Name='Extension';Expression={$_.Extension}},@{Name='Count';Expression={$_.Count}},@{Name='Size';Expression={$_.TotalSizeHuman}}

Write-Host "`nTop 10 Largest Directories:" -ForegroundColor Yellow
$byDirectory | Select-Object -First 10 | Format-Table -Property @{Name='Directory';Expression={$_.Directory}},@{Name='Count';Expression={$_.Count}},@{Name='Size';Expression={$_.TotalSizeHuman}}