package observability

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type level int

const (
	levelDebug level = iota
	levelInfo
	levelWarn
	levelError
)

const (
	colorReset  = "\x1b[0m"
	colorRed    = "\x1b[31m"
	colorYellow = "\x1b[33m"
	colorGreen  = "\x1b[32m"
	colorCyan   = "\x1b[36m"
)

var (
	logStateMu    sync.RWMutex
	minimumLevel            = levelInfo
	currentOutput io.Writer = os.Stdout
)

func init() {
	log.SetFlags(0)
	log.SetOutput(os.Stdout)
}

func Configure(level string) {
	logStateMu.Lock()
	defer logStateMu.Unlock()

	log.SetFlags(0)
	if level == "debug" {
		minimumLevel = levelDebug
	} else {
		minimumLevel = levelInfo
	}
	log.SetOutput(currentOutput)
}

func setOutput(w io.Writer) {
	if w == nil {
		w = os.Stdout
	}
	logStateMu.Lock()
	currentOutput = w
	log.SetOutput(w)
	logStateMu.Unlock()
}

func Debug(ctx context.Context, msg string, attrs ...any) {
	emit(levelDebug, ctx, msg, attrs...)
}

func Info(ctx context.Context, msg string, attrs ...any) {
	emit(levelInfo, ctx, msg, attrs...)
}

func Warn(ctx context.Context, msg string, attrs ...any) {
	emit(levelWarn, ctx, msg, attrs...)
}

func Error(ctx context.Context, msg string, attrs ...any) {
	emit(levelError, ctx, msg, attrs...)
}

func emit(lvl level, ctx context.Context, msg string, attrs ...any) {
	logStateMu.RLock()
	minLevel := minimumLevel
	writer := currentOutput
	logStateMu.RUnlock()

	if lvl < minLevel {
		return
	}

	fields := []string{
		"time=" + time.Now().UTC().Format(time.RFC3339Nano),
		"level=" + formatLevel(lvl, writer),
		"traceId=" + valueOrDash(TraceIDFromContext(ctx)),
		"msg=" + strconv.Quote(msg),
	}
	fields = append(fields, formatAttrs(attrs)...)
	log.Print(strings.Join(fields, " | "))
}

func formatLevel(lvl level, writer io.Writer) string {
	name := levelName(lvl)
	if writer != os.Stdout || !stdoutIsTerminal() {
		return name
	}
	return levelColor(lvl) + name + colorReset
}

func levelName(lvl level) string {
	switch lvl {
	case levelDebug:
		return "DEBUG"
	case levelWarn:
		return "WARN"
	case levelError:
		return "ERROR"
	default:
		return "INFO"
	}
}

func levelColor(lvl level) string {
	switch lvl {
	case levelDebug:
		return colorCyan
	case levelWarn:
		return colorYellow
	case levelError:
		return colorRed
	default:
		return colorGreen
	}
}

func stdoutIsTerminal() bool {
	info, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func formatAttrs(attrs []any) []string {
	fields := make([]string, 0, len(attrs)/2+1)
	limit := len(attrs)
	if len(attrs)%2 == 1 {
		limit--
	}
	for i := 0; i < limit; i += 2 {
		rawKey := fmt.Sprint(attrs[i])
		key := camelCaseKey(rawKey)
		if key == "" {
			key = fmt.Sprintf("attr%d", i/2+1)
		}
		if shouldRedact(rawKey, key) {
			fields = append(fields, key+"=***")
			continue
		}
		fields = append(fields, key+"="+formatAttrValue(attrs[i+1]))
	}
	if len(attrs)%2 == 1 {
		fields = append(fields, `attrError="odd_attr_count"`)
	}
	return fields
}

func camelCaseKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	parts := strings.FieldsFunc(key, func(r rune) bool {
		switch {
		case r >= 'a' && r <= 'z':
			return false
		case r >= 'A' && r <= 'Z':
			return false
		case r >= '0' && r <= '9':
			return false
		default:
			return true
		}
	})
	if len(parts) == 0 {
		return ""
	}
	if len(parts) == 1 && parts[0] == key {
		return lowerFirst(key)
	}
	for i, part := range parts {
		part = strings.ToLower(part)
		if i == 0 {
			parts[i] = part
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, "")
}

func lowerFirst(value string) string {
	if value == "" {
		return ""
	}
	if value[0] >= 'A' && value[0] <= 'Z' {
		return strings.ToLower(value[:1]) + value[1:]
	}
	return value
}

func shouldRedact(rawKey, normalizedKey string) bool {
	combined := strings.ToLower(rawKey + " " + normalizedKey)
	for _, token := range []string{"api_key", "apikey", "authorization", "token", "secret", "password"} {
		if strings.Contains(combined, token) {
			return true
		}
	}
	return false
}

func formatAttrValue(value any) string {
	if value == nil {
		return "-"
	}
	if err, ok := value.(error); ok {
		return strconv.Quote(err.Error())
	}
	switch v := value.(type) {
	case string:
		return formatString(v)
	case fmt.Stringer:
		return formatString(v.String())
	default:
		return fmt.Sprint(v)
	}
}

func formatString(value string) string {
	if value == "" {
		return "-"
	}
	if strings.Contains(value, "|") || strings.ContainsRune(value, ' ') || strings.ContainsAny(value, `"\\`) {
		return strconv.Quote(value)
	}
	return value
}

func valueOrDash(value string) string {
	if value == "" {
		return "-"
	}
	return value
}

func durationMilliseconds(d time.Duration) string {
	return strconv.FormatFloat(float64(d)/float64(time.Millisecond), 'f', 3, 64)
}
