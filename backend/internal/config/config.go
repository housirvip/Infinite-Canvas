package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server     ServerConfig     `yaml:"server"`
	Database   DatabaseConfig   `yaml:"database"`
	Auth       AuthConfig       `yaml:"auth"`
	Encryption EncryptionConfig `yaml:"encryption"`
	Storage    StorageConfig    `yaml:"storage"`
	Scheduler  SchedulerConfig  `yaml:"scheduler"`
	Log        LogConfig        `yaml:"log"`
}

type ServerConfig struct {
	Host string     `yaml:"host"`
	Port int        `yaml:"port"`
	CORS CORSConfig `yaml:"cors"`
}

type CORSConfig struct {
	AllowOrigins []string `yaml:"allowOrigins"`
}

type DatabaseConfig struct {
	Driver string `yaml:"driver"`
	DSN    string `yaml:"dsn"`
}

type AuthConfig struct {
	JWTSecret       string        `yaml:"jwtSecret"`
	AccessTokenTTL  time.Duration `yaml:"accessTokenTTL"`
	RefreshTokenTTL time.Duration `yaml:"refreshTokenTTL"`
}

type EncryptionConfig struct {
	MasterKey string `yaml:"masterKey"`
}

type StorageConfig struct {
	Type          string `yaml:"type"`
	LocalDir      string `yaml:"localDir"`
	MaxFileSizeMB int    `yaml:"maxFileSizeMB"`
	BaseURL       string `yaml:"baseURL"`
}

type SchedulerConfig struct {
	Concurrency map[string]int `yaml:"concurrency"`
	QueueSize   int            `yaml:"queueSize"`
}

type LogConfig struct {
	Level string `yaml:"level"`
}

const minJWTSecretLength = 32

func (c *Config) ValidateStartup() error {
	c.Auth.JWTSecret = strings.TrimSpace(c.Auth.JWTSecret)
	c.Encryption.MasterKey = strings.TrimSpace(c.Encryption.MasterKey)

	switch {
	case c.Auth.JWTSecret == "":
		return fmt.Errorf("auth.jwtSecret must be configured")
	case c.Auth.JWTSecret == "change-me-in-production":
		return fmt.Errorf("auth.jwtSecret must not use the default placeholder")
	case len(c.Auth.JWTSecret) < minJWTSecretLength:
		return fmt.Errorf("auth.jwtSecret must be at least %d characters", minJWTSecretLength)
	case c.Encryption.MasterKey == "":
		return fmt.Errorf("encryption.masterKey must be configured")
	}

	return nil
}

func Load(path string) (*Config, error) {
	cfg := defaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			applyEnvOverrides(cfg)
			return cfg, nil
		}
		return nil, err
	}

	expanded := os.ExpandEnv(string(data))
	if err := yaml.Unmarshal([]byte(expanded), cfg); err != nil {
		return nil, err
	}
	applyEnvOverrides(cfg)
	return cfg, nil
}

func applyEnvOverrides(cfg *Config) {
	if v := strings.TrimSpace(os.Getenv("JWT_SECRET")); v != "" {
		cfg.Auth.JWTSecret = v
	}
	if v := strings.TrimSpace(os.Getenv("ENCRYPTION_MASTER_KEY")); v != "" {
		cfg.Encryption.MasterKey = v
	}
}

func defaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Host: "0.0.0.0",
			Port: 3040,
			CORS: CORSConfig{
				AllowOrigins: []string{"*"},
			},
		},
		Database: DatabaseConfig{
			Driver: "sqlite",
			DSN:    "data/canvas.db",
		},
		Auth: AuthConfig{
			JWTSecret:       "change-me-in-production",
			AccessTokenTTL:  24 * time.Hour,
			RefreshTokenTTL: 7 * 24 * time.Hour,
		},
		Storage: StorageConfig{
			Type:          "local",
			LocalDir:      "data/files",
			MaxFileSizeMB: 200,
		},
		Scheduler: SchedulerConfig{
			Concurrency: map[string]int{
				"openai_image": 3,
				"openai_video": 3,
				"seedance":     3,
				"runninghub":   3,
				"audio":        5,
			},
			QueueSize: 100,
		},
		Log: LogConfig{
			Level: "info",
		},
	}
}
