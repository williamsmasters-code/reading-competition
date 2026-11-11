// Renders supabase/email-templates/reset-password.html with Go text/template AND html/template
// (Supabase Auth is written in Go) for 3 cases, to check the template syntax and make previews.
// go run . ../../supabase/email-templates/reset-password.html /tmp/out
package main

import (
	htmltpl "html/template"
	"os"
	"path/filepath"
	texttpl "text/template"
)

type D struct {
	ConfirmationURL, Email, SiteURL, Token, TokenHash, RedirectTo string
	Data                                                         map[string]interface{}
}

func main() {
	src, _ := os.ReadFile(os.Args[1])
	out := os.Args[2]
	cases := map[string]D{
		"new_account":    {ConfirmationURL: "https://example.invalid/verify?type=recovery", Email: "example.judge@example.com", Data: map[string]interface{}{"full_name": "Example Judge", "role_label": "Judge", "email_reason": "new_account"}},
		"password_reset": {ConfirmationURL: "https://example.invalid/verify?type=recovery", Email: "example.head@example.com", Data: map[string]interface{}{"full_name": "Example Head Judge", "role_label": "Head Judge", "email_reason": "password_reset"}},
		"no_metadata":    {ConfirmationURL: "https://example.invalid/verify?type=recovery", Email: "someone@example.com", Data: map[string]interface{}{}},
	}
	for name, d := range cases {
		t1 := texttpl.Must(texttpl.New("t").Parse(string(src)))
		f, _ := os.Create(filepath.Join(out, "text-"+name+".html"))
		if err := t1.Execute(f, d); err != nil { panic(err) }
		f.Close()
		t2 := htmltpl.Must(htmltpl.New("t").Parse(string(src)))
		g, _ := os.Create(filepath.Join(out, "html-"+name+".html"))
		if err := t2.Execute(g, d); err != nil { panic(err) }
		g.Close()
	}
}
