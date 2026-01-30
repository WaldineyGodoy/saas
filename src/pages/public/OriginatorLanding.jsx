import React from 'react';
import OriginatorSignupForm from '../../components/OriginatorSignupForm';

export default function OriginatorLanding() {
    React.useEffect(() => {
        console.log("DEBUG: OriginatorLanding Mounted v1.0");
    }, []);

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ width: '100%', maxWidth: '42rem' }}>
                <OriginatorSignupForm />
            </div>
        </div>
    );
}
