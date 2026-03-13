package main

import (
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// IPRateLimiter tracks per-IP token bucket limiters.
type IPRateLimiter struct {
	mu       sync.RWMutex
	limiters map[string]*visitorLimiter
	rate     rate.Limit
	burst    int
}

type visitorLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// NewIPRateLimiter creates a rate limiter allowing rps requests per second with the given burst.
func NewIPRateLimiter(rps float64, burst int) *IPRateLimiter {
	rl := &IPRateLimiter{
		limiters: make(map[string]*visitorLimiter),
		rate:     rate.Limit(rps),
		burst:    burst,
	}
	go rl.cleanup()
	return rl
}

func (rl *IPRateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, ok := rl.limiters[ip]
	if !ok {
		v = &visitorLimiter{
			limiter: rate.NewLimiter(rl.rate, rl.burst),
		}
		rl.limiters[ip] = v
	}
	v.lastSeen = time.Now()
	return v.limiter
}

func (rl *IPRateLimiter) cleanup() {
	for {
		time.Sleep(5 * time.Minute)
		rl.mu.Lock()
		for ip, v := range rl.limiters {
			if time.Since(v.lastSeen) > 10*time.Minute {
				delete(rl.limiters, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware wraps an http.Handler with per-IP rate limiting.
func (rl *IPRateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		if ip == "" {
			ip = r.RemoteAddr
		}
		// Prefer X-Forwarded-For behind reverse proxy (Fly.io)
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}

		if !rl.getLimiter(ip).Allow() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "too many requests, try again shortly",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
