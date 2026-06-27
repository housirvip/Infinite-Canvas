package provider

import (
	"path/filepath"
	"strings"
)

func mimeForExt(extOrFilename string) string {
	ext := extOrFilename
	if strings.Contains(ext, ".") {
		ext = filepath.Ext(ext)
	}
	ext = strings.TrimPrefix(strings.ToLower(ext), ".")
	switch ext {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	case "bmp":
		return "image/bmp"
	case "mp4":
		return "video/mp4"
	case "mov":
		return "video/quicktime"
	case "webm":
		return "video/webm"
	case "avi":
		return "video/x-msvideo"
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "ogg":
		return "audio/ogg"
	case "flac":
		return "audio/flac"
	case "m4a":
		return "audio/mp4"
	case "aac":
		return "audio/aac"
	default:
		return "application/octet-stream"
	}
}
