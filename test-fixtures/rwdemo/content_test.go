package rwdemo

import "testing"

func TestBuild(t *testing.T) {
	c := Build([]string{"x"})
	if len(c.Items) == 0 {
		t.Fatal("empty")
	}
	c.Items[0] = "y"
	c.Items = c.Items[:1]
}
