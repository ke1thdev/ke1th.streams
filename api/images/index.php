<?php
// XAMPP/PHP image cache. The upstream host and valid file names are fixed.
declare(strict_types=1);

function fail_image(int $status): void {
    http_response_code($status);
    header('Cache-Control: no-store');
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'HEAD'], true)) {
    header('Allow: GET, HEAD');
    fail_image(405);
}
$size = $_GET['size'] ?? '';
$file = $_GET['file'] ?? '';
if (!is_string($size) || !in_array($size, ['w200', 'w500', 'w1280'], true) ||
    !is_string($file) || !preg_match('/\A[A-Za-z0-9_-]+\.(?:jpg|png|webp)\z/D', $file)) {
    fail_image(400);
}
$directory = dirname(__DIR__, 2) . '/assets/imgs/tmdb/' . $size;
$target = $directory . '/' . $file;
$hit = is_file($target) && filesize($target) > 100;
if (!$hit) {
    if (!function_exists('curl_init')) fail_image(503);
    $curl = curl_init('https://image.tmdb.org/t/p/' . $size . '/' . $file);
    $body = '';
    curl_setopt_array($curl, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_USERAGENT => 'Streammovies artwork cache/3.4.4',
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > 8 * 1024 * 1024) return 0;
            $body .= $chunk;
            return strlen($chunk);
        }
    ]);
    $ok = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($ok === false || $status !== 200) fail_image($status === 404 ? 404 : 502);
    $image = @getimagesizefromstring($body);
    if (!$image || !in_array($image['mime'], ['image/jpeg', 'image/png', 'image/webp'], true)) fail_image(502);
    if (!is_dir($directory) && !@mkdir($directory, 0755, true) && !is_dir($directory)) fail_image(503);
    $temporary = tempnam($directory, 'image-');
    if ($temporary === false) fail_image(503);
    if (file_put_contents($temporary, $body, LOCK_EX) === false || !@rename($temporary, $target)) {
        @unlink($temporary);
        fail_image(503);
    }
}
$info = @getimagesize($target);
if (!$info) fail_image(502);
$etag = '"' . hash_file('sha256', $target) . '"';
header('Content-Type: ' . $info['mime']);
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=31536000, immutable');
header('ETag: ' . $etag);
header('X-Artwork-Cache: ' . ($hit ? 'HIT' : 'MISS'));
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Length: ' . filesize($target));
if ($_SERVER['REQUEST_METHOD'] === 'GET') readfile($target);
