package observability

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm/logger"
)

const gormSlowQueryThreshold = 200 * time.Millisecond

type gormLogger struct {
	level logger.LogLevel
}

func NewGormLogger(level string) logger.Interface {
	gormLevel := logger.Warn
	if level == "debug" {
		gormLevel = logger.Info
	}
	return &gormLogger{level: gormLevel}
}

func (l *gormLogger) LogMode(level logger.LogLevel) logger.Interface {
	clone := *l
	clone.level = level
	return &clone
}

func (l *gormLogger) Info(ctx context.Context, msg string, data ...interface{}) {
	if l.level < logger.Info {
		return
	}
	Debug(ctx, fmt.Sprintf(msg, data...))
}

func (l *gormLogger) Warn(ctx context.Context, msg string, data ...interface{}) {
	if l.level < logger.Warn {
		return
	}
	Warn(ctx, fmt.Sprintf(msg, data...))
}

func (l *gormLogger) Error(ctx context.Context, msg string, data ...interface{}) {
	if l.level < logger.Error {
		return
	}
	Error(ctx, fmt.Sprintf(msg, data...))
}

func (l *gormLogger) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	if l.level == logger.Silent {
		return
	}

	sql, rows := fc()
	attrs := []any{
		"elapsedMs", durationMilliseconds(time.Since(begin)),
		"rows", rows,
	}
	if l.level >= logger.Info {
		attrs = append(attrs, "sql", sql)
	}
	if err != nil {
		if l.level >= logger.Error {
			attrs = append(attrs, "error", err)
			Error(ctx, "gorm query", attrs...)
		}
		return
	}
	if l.level >= logger.Warn && time.Since(begin) > gormSlowQueryThreshold {
		Warn(ctx, "gorm query", attrs...)
		return
	}
	if l.level >= logger.Info {
		Debug(ctx, "gorm query", attrs...)
	}
}
