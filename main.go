package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"time"
)

//go:embed static
var staticFS embed.FS

var debugMode bool

// calcmarkVersion returns the go-calcmark module version from build info.
func calcmarkVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	for _, dep := range info.Deps {
		if dep.Path == "github.com/CalcMark/go-calcmark" {
			return dep.Version
		}
	}
	return "dev"
}

func main() {
	port := flag.String("port", "", "port to listen on (default: $PORT or 8080)")
	flag.BoolVar(&debugMode, "debug", false, "enable debug logging")
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

	// Static assets (JS, images)
	sub, _ := fs.Sub(staticFS, "static")
	fileServer := http.FileServer(http.FS(sub))

	// Pages served from Go templates (shared layout)
	servePage := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(getPage(name)))
		}
	}

	// Example endpoint: GET /x/<name> serves the index page (JS loads the example)
	mux.HandleFunc("/x/", servePage("index"))

	// About page
	mux.HandleFunc("/about", servePage("about"))

	// Root: serve index page for /, static files for everything else
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			servePage("index")(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	log.Printf("CalcMark Lark listening on :%s", *port)
	if debugMode {
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
