import React from 'react'
import ReactDOM from 'react-dom/client'
import DemoStand from './App.jsx'

// Error boundary — если что-то упало в проде, покажем внятное сообщение
// вместо чёрного экрана.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    // eslint-disable-next-line no-console
    console.error('DemoStand crashed:', err, info)
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{
          padding: 40, maxWidth: 640, margin: '60px auto',
          background: '#12203A', border: '1px solid #1E3252', borderRadius: 12,
          fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#D9E4F5',
        }}>
          <h1 style={{ color: '#E30611', margin: '0 0 12px', fontSize: 16 }}>
            Стенд не смог загрузиться
          </h1>
          <p style={{ color: '#7E90AC', margin: 0 }}>
            Обновите страницу. Если ошибка повторяется — попробуйте другой браузер
            (Chrome 87+, Safari 12+, Firefox 78+) или откройте в режиме инкогнито.
          </p>
          <pre style={{
            marginTop: 16, padding: 12, background: '#0E1A30', borderRadius: 6,
            fontSize: 11, color: '#F5B02E', overflow: 'auto', whiteSpace: 'pre-wrap',
          }}>{String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Убираем boot-screen после маунта — SSR не задействован, всё клиентское
const hideBoot = () => {
  const boot = document.getElementById('__boot')
  if (boot) {
    boot.classList.add('hide')
    setTimeout(() => boot.remove(), 400)
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <DemoStand />
    </ErrorBoundary>
  </React.StrictMode>,
)

// hideBoot после первого paint
if (typeof requestAnimationFrame !== 'undefined') {
  requestAnimationFrame(() => requestAnimationFrame(hideBoot))
} else {
  setTimeout(hideBoot, 100)
}
