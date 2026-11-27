package rwdemo

type Content struct {
	Items []string
	Name  string
}

type Bag struct {
	Children []*Content
}

func Build(input []string) *Content {
	c := &Content{
		Items: input,
		Name:  "demo",
	}
	c.Items = append(c.Items, "extra")
	n := len(c.Items)
	n++
	if n > 0 {
		c.Name = c.Items[0]
	}
	return c
}

func Fill(bag *Bag) {
	bag.Children[0].Items = nil
	for _, d := range bag.Children[0].Items {
		_ = d
	}
	items := []Content{{Items: []string{"a"}}}
	_ = items
}

func makeItems(in []string) []string {
	return in
}

func makeItemsMulti(in []string) []string {
	return in
}

// 结构体字面量字段初始化，值是一次跨行函数调用。
func Create(targets []string) *Content {
	task := &Content{
		Items: makeItems(targets),
		Name:  "demo",
	}
	wrapped := &Content{
		Items: makeItemsMulti(
			targets,
		),
	}
	_, _ = task, wrapped
	return nil
}
