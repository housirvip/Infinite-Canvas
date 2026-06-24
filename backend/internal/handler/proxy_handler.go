package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type ProxyHandler struct{}

func NewProxyHandler() *ProxyHandler {
	return &ProxyHandler{}
}

func (h *ProxyHandler) WebDAVProxy(c *gin.Context) {
	target := c.GetHeader("x-webdav-target")
	method := strings.ToUpper(c.GetHeader("x-webdav-method"))
	if target == "" {
		c.String(http.StatusBadRequest, "Missing x-webdav-target")
		return
	}
	if method == "" {
		method = "GET"
	}

	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		c.String(http.StatusBadRequest, "Unsupported WebDAV target")
		return
	}

	var body io.Reader
	if method != "GET" && method != "HEAD" {
		body = c.Request.Body
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), method, target, body)
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid target URL")
		return
	}

	proxyHeaders := map[string]string{
		"x-webdav-authorization": "Authorization",
		"x-webdav-depth":        "Depth",
		"x-webdav-destination":  "Destination",
		"x-webdav-overwrite":    "Overwrite",
		"x-webdav-content-type": "Content-Type",
	}
	for from, to := range proxyHeaders {
		if v := c.GetHeader(from); v != "" {
			req.Header.Set(to, v)
		}
	}

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.String(http.StatusBadGateway, "WebDAV proxy error: %s", err.Error())
		return
	}
	defer resp.Body.Close()

	for _, key := range []string{"Content-Type", "Etag", "Last-Modified", "Dav"} {
		if v := resp.Header.Get(key); v != "" {
			c.Header(key, v)
		}
	}

	if method == "HEAD" {
		c.Status(resp.StatusCode)
		return
	}

	c.DataFromReader(resp.StatusCode, resp.ContentLength, resp.Header.Get("Content-Type"), resp.Body, nil)
}

// --- Prompts Aggregator ---

type promptItem struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	CoverURL  string   `json:"coverUrl"`
	Prompt    string   `json:"prompt"`
	Tags      []string `json:"tags"`
	Category  string   `json:"category"`
	GithubURL string   `json:"githubUrl"`
	Preview   string   `json:"preview"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type promptCategory struct {
	category  string
	githubURL string
	buildURL  string
	format    string
}

var promptSources = []promptCategory{
	{"gpt-image-2-prompts", "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/data/ingested_tweets.json", "gpt-image-2"},
}

var (
	promptCache     []promptItem
	promptCacheTime time.Time
	promptCacheMu   sync.Mutex
	promptCacheTTL  = time.Hour
)

func (h *ProxyHandler) Prompts(c *gin.Context) {
	keyword := strings.ToLower(strings.TrimSpace(c.Query("keyword")))
	category := c.Query("category")
	tags := c.QueryArray("tag")
	page := max(1, intQuery(c, "page", 1))
	pageSize := clamp(intQuery(c, "pageSize", 20), 1, 100)

	items := getCachedPrompts()

	filtered := filterPrompts(items, keyword, category, tags)
	allTags := collectTags(filterPrompts(items, keyword, category, nil))

	categories := make([]string, 0, len(promptSources))
	for _, s := range promptSources {
		categories = append(categories, s.category)
	}

	start := (page - 1) * pageSize
	end := start + pageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	if end > len(filtered) {
		end = len(filtered)
	}

	c.JSON(http.StatusOK, gin.H{
		"items":      filtered[start:end],
		"tags":       allTags,
		"categories": categories,
		"total":      len(filtered),
	})
}

func getCachedPrompts() []promptItem {
	promptCacheMu.Lock()
	defer promptCacheMu.Unlock()

	if promptCache != nil && time.Since(promptCacheTime) < promptCacheTTL {
		return promptCache
	}

	go func() {
		items := loadAllPrompts()
		promptCacheMu.Lock()
		promptCache = items
		promptCacheTime = time.Now()
		promptCacheMu.Unlock()
	}()

	if promptCache != nil {
		return promptCache
	}

	items := loadAllPrompts()
	promptCache = items
	promptCacheTime = time.Now()
	return items
}

func loadAllPrompts() []promptItem {
	type tweetRecord struct {
		Title    string `json:"title"`
		TweetURL string `json:"tweet_url"`
		ImageDir string `json:"image_dir"`
		Category string `json:"category"`
		AddedAt  string `json:"added_at"`
	}
	type tweetData struct {
		Records []tweetRecord `json:"records"`
	}

	var items []promptItem

	resp, err := http.Get("https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/data/ingested_tweets.json")
	if err != nil {
		return items
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data tweetData
	if err := json.Unmarshal(body, &data); err != nil {
		return items
	}

	baseURL := "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main"
	for i, record := range data.Records {
		if record.Title == "" || record.ImageDir == "" {
			continue
		}
		image := fmt.Sprintf("%s/%s/output.jpg", baseURL, record.ImageDir)
		var tags []string
		for _, t := range strings.Split(record.Category, "&") {
			t = strings.ToLower(strings.TrimSpace(t))
			if t != "" {
				tags = append(tags, t)
			}
		}
		items = append(items, promptItem{
			ID:        fmt.Sprintf("gpt-image-2-prompts-%04d", i+1),
			Title:     record.Title,
			CoverURL:  image,
			Prompt:    record.Title,
			Tags:      tags,
			Category:  "gpt-image-2-prompts",
			GithubURL: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
			Preview:   fmt.Sprintf("![](%%s)", image),
			CreatedAt: record.AddedAt,
			UpdatedAt: record.AddedAt,
		})
	}

	return items
}

func filterPrompts(items []promptItem, keyword, category string, tags []string) []promptItem {
	var result []promptItem
	for _, item := range items {
		if category != "" && category != "全部" && category != "all" && item.Category != category {
			continue
		}
		if len(tags) > 0 && !hasAnyTag(item.Tags, tags) {
			continue
		}
		if keyword != "" {
			searchable := strings.ToLower(item.Title + " " + item.Prompt + " " + item.Category + " " + strings.Join(item.Tags, " "))
			if !strings.Contains(searchable, keyword) {
				continue
			}
		}
		result = append(result, item)
	}
	if result == nil {
		result = []promptItem{}
	}
	return result
}

func collectTags(items []promptItem) []string {
	seen := map[string]bool{}
	var tags []string
	for _, item := range items {
		for _, tag := range item.Tags {
			if tag != "" && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	if tags == nil {
		tags = []string{}
	}
	return tags
}

func hasAnyTag(itemTags, filterTags []string) bool {
	for _, ft := range filterTags {
		for _, it := range itemTags {
			if it == ft {
				return true
			}
		}
	}
	return false
}

func intQuery(c *gin.Context, key string, def int) int {
	v := c.Query(key)
	if v == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
		return def
	}
	return n
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
