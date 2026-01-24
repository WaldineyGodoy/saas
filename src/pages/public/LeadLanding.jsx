import React from 'react';
import LeadCaptureForm from '../../components/LeadCaptureForm';

export default function LeadLanding() {
    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ width: '100%', maxWidth: '42rem' }}>
                <LeadCaptureForm />
            </div>
        </div>
    );
}
