import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Check } from 'lucide-react';

const TOUR_STEPS = [
    {
        target: '[data-tour="nova-usina"]',
        title: 'Passo 1: Crie sua Usina',
        content: 'Tudo começa pela usina! Clique aqui para cadastrar a fonte geradora dos seus créditos de energia.',
        position: 'bottom'
    },
    {
        target: '[data-tour="tab-ucs"]',
        title: 'Passo 2: Unidades Consumidoras',
        content: 'Nesta aba você cadastrará as UCs que estão vinculadas à usina e recebem os créditos.',
        position: 'bottom'
    },
    {
        target: '[data-tour="tab-faturas"]',
        title: 'Passo 3: Importar Faturas',
        content: 'Aqui você fará o upload dos PDFs das faturas para que nosso sistema extraia todos os dados (OCR).',
        position: 'bottom'
    },
    {
        target: '[data-tour="btn-analise"]',
        title: 'Passo 4: Análise de Dados',
        content: 'Pronto! Com tudo inserido, clique neste botão para acessar o Dashboard completo com balanço e auditoria.',
        position: 'bottom-right'
    }
];

export default function OnboardingTour() {
    const [isVisible, setIsVisible] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);
    const [targetRect, setTargetRect] = useState(null);

    useEffect(() => {
        const hasSeenTour = localStorage.getItem('hasSeenOnboardingTour');
        if (!hasSeenTour) {
            // Pequeno atraso para garantir que o DOM foi renderizado
            setTimeout(() => setIsVisible(true), 800);
        }
    }, []);

    useEffect(() => {
        if (!isVisible) return;

        const updatePosition = () => {
            const step = TOUR_STEPS[currentStep];
            if (!step) return;

            const targetElement = document.querySelector(step.target);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Aguarda o scroll
                setTimeout(() => {
                    const rect = targetElement.getBoundingClientRect();
                    setTargetRect(rect);
                }, 300);
            } else {
                // Tenta novamente caso o elemento ainda esteja montando (ex: animações)
                setTimeout(() => {
                    const el = document.querySelector(step.target);
                    if (el) setTargetRect(el.getBoundingClientRect());
                }, 500);
            }
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition);
        };
    }, [currentStep, isVisible]);

    const handleNext = () => {
        if (currentStep < TOUR_STEPS.length - 1) {
            setCurrentStep(c => c + 1);
        } else {
            handleClose();
        }
    };

    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(c => c - 1);
        }
    };

    const handleClose = () => {
        setIsVisible(false);
        localStorage.setItem('hasSeenOnboardingTour', 'true');
    };

    if (!isVisible) return null;

    const step = TOUR_STEPS[currentStep];

    // Estilos de posição dinâmicos
    let popupStyle = {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 100000,
        opacity: targetRect ? 1 : 0,
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
    };

    let pointerStyle = { display: 'none' };

    if (targetRect) {
        const gap = 20; // Distância do elemento alvo
        if (step.position === 'bottom') {
            popupStyle = {
                position: 'fixed',
                top: `${targetRect.bottom + gap}px`,
                left: `${targetRect.left + (targetRect.width / 2)}px`,
                transform: 'translate(-50%, 0)',
                zIndex: 100000,
                opacity: 1,
                transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
            };
            pointerStyle = {
                display: 'block',
                position: 'absolute',
                top: '-10px',
                left: '50%',
                transform: 'translateX(-50%) rotate(45deg)',
                width: '20px',
                height: '20px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.5)',
                borderTop: '1px solid rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(24px)',
                zIndex: -1
            };
        } else if (step.position === 'bottom-right') {
            popupStyle = {
                position: 'fixed',
                top: `${targetRect.bottom + gap}px`,
                left: `${targetRect.right}px`,
                transform: 'translate(-100%, 0)',
                zIndex: 100000,
                opacity: 1,
                transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
            };
            pointerStyle = {
                display: 'block',
                position: 'absolute',
                top: '-10px',
                right: '24px',
                transform: 'rotate(45deg)',
                width: '20px',
                height: '20px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.5)',
                borderTop: '1px solid rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(24px)',
                zIndex: -1
            };
        }
    }

    return (
        <div className="fixed inset-0 z-[99999] pointer-events-none">
            {/* Máscara de foco escurecida */}
            <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px] transition-all duration-500 pointer-events-auto" onClick={handleClose}></div>
            
            {/* Highlight dinâmico sobre o botão alvo */}
            {targetRect && (
                <div 
                    className="absolute rounded-xl transition-all pointer-events-none z-[100000] ring-4 ring-emerald-400/50 shadow-[0_0_20px_5px_rgba(52,211,153,0.3)] bg-white/10"
                    style={{
                        top: targetRect.top - 6,
                        left: targetRect.left - 6,
                        width: targetRect.width + 12,
                        height: targetRect.height + 12,
                        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}
                ></div>
            )}

            {/* Popup Principal - Estética Liquid Glass */}
            <div style={popupStyle} className="w-[360px] pointer-events-auto filter drop-shadow-[0_20px_40px_rgba(0,0,0,0.15)]">
                {/* Seta do Balão */}
                <div style={pointerStyle}></div>
                
                {/* Corpo do Glass */}
                <div className="relative overflow-hidden rounded-[1.5rem] border border-white/60 bg-white/30 backdrop-blur-3xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] p-7 text-gray-800">
                    
                    {/* Efeitos Líquidos (Orbs animados) */}
                    <div className="absolute -top-12 -right-12 w-40 h-40 bg-emerald-400/30 rounded-full blur-[40px] animate-[pulse_4s_ease-in-out_infinite]"></div>
                    <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-cyan-400/20 rounded-full blur-[40px] animate-[pulse_5s_ease-in-out_infinite]"></div>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-white/20 to-white/10 z-0 mix-blend-overlay"></div>
                    
                    {/* Conteúdo */}
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800/80 bg-emerald-200/50 px-2.5 py-1 rounded-lg backdrop-blur-md shadow-sm border border-emerald-300/30">
                                Passo {currentStep + 1} / {TOUR_STEPS.length}
                            </span>
                            <button onClick={handleClose} className="text-gray-500 hover:text-gray-900 transition-colors p-1.5 rounded-full hover:bg-white/40">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        
                        <h3 className="text-xl font-extrabold text-gray-900 mb-2.5 leading-tight tracking-tight drop-shadow-sm">
                            {step.title}
                        </h3>
                        <p className="text-sm text-gray-700 font-semibold mb-8 leading-relaxed">
                            {step.content}
                        </p>
                        
                        <div className="flex justify-between items-center">
                            <button onClick={handleClose} className="text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors">
                                Pular tour
                            </button>
                            <div className="flex space-x-2">
                                {currentStep > 0 && (
                                    <button onClick={handlePrev} className="p-2.5 rounded-xl bg-white/40 hover:bg-white/60 text-gray-800 transition-all border border-white/60 shadow-sm backdrop-blur-md">
                                        <ChevronLeft className="w-4 h-4" />
                                    </button>
                                )}
                                <button onClick={handleNext} className="flex items-center px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold shadow-lg shadow-emerald-500/40 border border-emerald-400/50 transition-all group">
                                    {currentStep === TOUR_STEPS.length - 1 ? (
                                        <>Finalizar <Check className="w-4 h-4 ml-1.5 opacity-90" /></>
                                    ) : (
                                        <>Próximo <ChevronRight className="w-4 h-4 ml-1.5 opacity-90 group-hover:translate-x-1 transition-transform" /></>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
