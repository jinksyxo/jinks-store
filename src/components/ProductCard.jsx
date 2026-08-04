function ProductCard({ product, onNavigate }) {
  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value)
  const formatColorLabel = (value) => value.replace('-', ' ')
  const sizeSummary = Array.isArray(product.allowedSizes) ? product.allowedSizes.join(', ') : ''
  const primaryImage = product.images?.[0] || '/tee-mockup.png'
  const hoverImage = product.images?.[1] || product.images?.[0] || '/tee-mockup-hover.jpg'
  const hasDeal = product.hasDeal && product.salePrice
  const colorSummary =
    product.colors?.length ? product.colors.map(formatColorLabel).join(', ') : null
  const variantSummary = [colorSummary, sizeSummary].filter(Boolean).join(' • ') || null
  const productHref = `/products/${product.slug}`

  return (
    <article className="product-card">
      <div
        className="product-art"
        style={{
          '--product-tint': product.tint,
        }}
      >
        <span className="product-badge">{product.tag}</span>
        <div className="product-image-wrap">
          <img
            className="product-image product-image-primary"
            src={primaryImage}
            alt={`${product.name} mockup`}
          />
          <img
            className="product-image product-image-hover"
            src={hoverImage}
            alt=""
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="product-copy">
        <div className="product-meta">
          <h3>{product.name}</h3>
          {hasDeal ? (
            <span className="product-price-stack">
              <strong>{formatCurrency(product.salePrice)}</strong>
              <small>{formatCurrency(product.price)}</small>
            </span>
          ) : (
            <span>{formatCurrency(product.price)}</span>
          )}
        </div>
        <p>{product.description}</p>
        {variantSummary ? <p className="product-variant-note">{variantSummary}</p> : null}
        <div className="product-actions">
          <a
            className="button button-primary"
            href={productHref}
            onClick={(event) => onNavigate(event, productHref)}
          >
            Choose options
          </a>
        </div>
      </div>
    </article>
  )
}

export default ProductCard
