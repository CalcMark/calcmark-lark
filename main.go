package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"
)

//go:embed static
var staticFS embed.FS

var debug bool

func main() {
	port := flag.String("port", "", "port to listen on (default: $PORT or 8080)")
	flag.BoolVar(&debug, "debug", false, "enable debug logging")
	flag.Parse()

	if *port == "" {
		*port = os.Getenv("PORT")
	}
	if *port == "" {
		*port = "8080"
	}

	mux := http.NewServeMux()

	// API with rate limiting and timeout
	limiter := NewIPRateLimiter(1, 10) // 1 req/sec sustained, burst of 10
	mux.Handle("/api/convert", limiter.Middleware(
		timeoutHandler(http.HandlerFunc(handleConvert), 5*time.Second),
	))

	// Document endpoint: GET /d/<payload> returns raw CalcMark source
	mux.HandleFunc("/d/", handleDocument)

	// Static frontend
	sub, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", http.FileServer(http.FS(sub)))

	log.Printf("CalcMark Lark listening on :%s", *port)
	if debug {
		log.Println("debug logging enabled")
	}
	log.Fatal(http.ListenAndServe(":"+*port, mux))
}

// timeoutHandler wraps a handler with a context deadline.
func timeoutHandler(h http.Handler, d time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), d)
		defer cancel()
		h.ServeHTTP(w, r.WithContext(ctx))
	})
}
