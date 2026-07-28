/**
 * 将搜索词按空格分割为关键词数组（去除空字符串、大小写无关）
 */
export function parseSearchKeywords(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).map((k) => k.toLowerCase())
}

/**
 * 根据关键词过滤列表项。空关键词返回原列表。
 * 关键词之间为 AND 关系：每个关键词都需在 getName(item) 中命中。
 *
 * @param items - 要过滤的列表
 * @param query - 搜索词（支持空格分隔多个关键词）
 * @param getName - 从每个 item 提取名称字段的函数
 */
export function filterBySearch<T>(
  items: T[],
  query: string,
  getName: (item: T) => string,
): T[] {
  const keywords = parseSearchKeywords(query)
  if (keywords.length === 0) return items
  return items.filter((item) => {
    const name = getName(item).toLowerCase()
    return keywords.every((kw) => name.includes(kw))
  })
}
