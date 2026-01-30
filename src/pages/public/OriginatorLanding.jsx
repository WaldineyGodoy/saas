import React from 'react';
import OriginatorSignupForm from '../../components/OriginatorSignupForm';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
        this.setState({ error, errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', color: 'red', backgroundColor: '#fee2e2', border: '1px solid red', borderRadius: '8px' }}>
                    <h2>Algo deu errado.</h2>
                    <details style={{ whiteSpace: 'pre-wrap' }}>
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </details>
                </div>
            );
        }

        return this.props.children;
    }
}

export default function OriginatorLanding() {
    React.useEffect(() => {
        console.log("DEBUG: OriginatorLanding Mounted v1.1 - With ErrorBoundary");
    }, []);

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ width: '100%', maxWidth: '42rem' }}>
                <ErrorBoundary>
                    <OriginatorSignupForm />
                </ErrorBoundary>
            </div>
        </div>
    );
}
