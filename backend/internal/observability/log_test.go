package observability

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
)

func captureLogLine(t *testing.T, level string, fn func()) string {
	t.Helper()

	var buf bytes.Buffer
	setOutput(&buf)
	Configure(level)
	t.Cleanup(func() {
		setOutput(os.Stdout)
		Configure("info")
	})

	fn()
	return strings.TrimSpace(buf.String())
}

func TestInfoLogFormatsHumanReadableLine(t *testing.T) {
	line := captureLogLine(t, "info", func() {
		Info(ContextWithTraceID(context.Background(), "trace-123"), "hello world", "userId", 7)
	})

	if !strings.HasPrefix(line, "time=") {
		t.Fatalf("expected time prefix, got %q", line)
	}
	if !strings.Contains(line, " | level=INFO | traceId=trace-123 | msg=\"hello world\" | userId=7") {
		t.Fatalf("expected formatted info line, got %q", line)
	}
}

func TestLogRedactsSensitiveAttributes(t *testing.T) {
	line := captureLogLine(t, "info", func() {
		Info(context.Background(), "auth check", "authorization", "Bearer secret", "apiKey", "abc123")
	})

	if !strings.Contains(line, "authorization=***") {
		t.Fatalf("expected authorization redaction, got %q", line)
	}
	if !strings.Contains(line, "apiKey=***") {
		t.Fatalf("expected apiKey redaction, got %q", line)
	}
	if strings.Contains(line, "Bearer secret") || strings.Contains(line, "abc123") {
		t.Fatalf("expected sensitive values to be absent, got %q", line)
	}
}

func TestLogOddAttributeCountAddsAttrError(t *testing.T) {
	line := captureLogLine(t, "info", func() {
		Info(context.Background(), "odd attrs", "userId", 7, "dangling")
	})

	if !strings.Contains(line, "userId=7") {
		t.Fatalf("expected userId attribute, got %q", line)
	}
	if !strings.Contains(line, `attrError="odd_attr_count"`) {
		t.Fatalf("expected attrError marker, got %q", line)
	}
	if strings.Contains(line, "dangling=") {
		t.Fatalf("expected dangling key to be ignored, got %q", line)
	}
}

func TestLogHasNoANSIColorWhenOutputIsNotTerminal(t *testing.T) {
	line := captureLogLine(t, "info", func() {
		Warn(context.Background(), "warn message")
	})

	if strings.Contains(line, "\x1b[") {
		t.Fatalf("expected no ANSI escape sequences, got %q", line)
	}
}
