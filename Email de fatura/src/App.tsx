import { 
  FileText, 
  TrendingDown, 
  BarChart3, 
  Download, 
  ExternalLink, 
  Mail, 
  Phone, 
  Globe,
  CheckCircle2,
  Calendar,
  CreditCard
} from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  const brandLogo = "https://b2wenergia.com.br/wp-content/uploads/2025/12/Logo-Laranja-estreito.png";
  const appUrl = "https://app.b2wenergia.com.br";

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 font-sans text-gray-800">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
        
        {/* Header */}
        <header className="bg-white p-8 flex justify-center border-b border-gray-100">
          <img 
            src={brandLogo} 
            alt="B2W Energia" 
            className="h-12 object-contain"
            referrerPolicy="no-referrer"
          />
        </header>

        {/* Hero Section */}
        <section className="bg-brand-blue text-white p-10 text-center relative overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-orange rounded-full mb-6 shadow-lg">
              <FileText className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold mb-3 tracking-tight">Sua fatura chegou!</h1>
            <p className="text-brand-blue-light text-lg opacity-90">
              Olá, assinante. A sua fatura do mês já está disponível para pagamento.
            </p>
          </motion.div>
          
          {/* Decorative background elements */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-brand-blue-light rounded-full opacity-10 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 bg-brand-orange rounded-full opacity-5 blur-2xl"></div>
        </section>

        {/* Main Content */}
        <main className="p-8 md:p-12">
          
          {/* Quick Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
            <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 flex items-start gap-4">
              <div className="bg-blue-100 p-2 rounded-lg">
                <Calendar className="text-brand-blue w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Vencimento</p>
                <p className="text-lg font-bold text-brand-blue">10 de Abril, 2026</p>
              </div>
            </div>
            <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 flex items-start gap-4">
              <div className="bg-orange-100 p-2 rounded-lg">
                <CreditCard className="text-brand-orange w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Valor Total</p>
                <p className="text-lg font-bold text-brand-blue">R$ 452,80</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 mb-10">
            <h2 className="text-xl font-bold text-brand-blue flex items-center gap-2">
              <CheckCircle2 className="text-brand-orange w-6 h-6" />
              Tudo em um só lugar
            </h2>
            <p className="text-gray-600 leading-relaxed">
              Como cliente <strong>B2W Energia</strong>, você tem acesso exclusivo ao nosso portal para gerenciar sua conta com total transparência e praticidade.
            </p>
            
            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-center gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                <div className="bg-green-100 p-3 rounded-full">
                  <TrendingDown className="text-green-600 w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-brand-blue">Economia do Mês</h3>
                  <p className="text-sm text-gray-500">Acompanhe quanto você economizou na sua conta de luz.</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                <div className="bg-blue-100 p-3 rounded-full">
                  <BarChart3 className="text-brand-blue w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-brand-blue">Consumo Detalhado</h3>
                  <p className="text-sm text-gray-500">Consulte seu histórico de consumo de forma simples.</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                <div className="bg-orange-100 p-3 rounded-full">
                  <Download className="text-brand-orange w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-brand-blue">Segunda Via</h3>
                  <p className="text-sm text-gray-500">Baixe o boleto atualizado sempre que precisar.</p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Button */}
          <div className="text-center">
            <motion.a
              href={appUrl}
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center justify-center gap-3 bg-brand-orange hover:bg-brand-orange-dark text-white font-bold py-4 px-10 rounded-full shadow-lg transition-all duration-300 text-lg group"
            >
              Acessar minha conta
              <ExternalLink className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </motion.a>
            <p className="mt-4 text-sm text-gray-400">
              Ou acesse: <span className="text-brand-blue font-medium">app.b2wenergia.com.br</span>
            </p>
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-gray-50 border-t border-gray-100 p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <div className="space-y-3">
              <h4 className="font-bold text-brand-blue text-sm uppercase tracking-wider">Canais de Atendimento</h4>
              <div className="flex items-center gap-3 text-gray-600 text-sm">
                <Phone className="w-4 h-4 text-brand-orange" />
                <span>0800 123 4567</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600 text-sm">
                <Mail className="w-4 h-4 text-brand-orange" />
                <span>atendimento@b2wenergia.com.br</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600 text-sm">
                <Globe className="w-4 h-4 text-brand-orange" />
                <span>www.b2wenergia.com.br</span>
              </div>
            </div>
            <div className="flex flex-col justify-end items-start md:items-end">
              <img 
                src={brandLogo} 
                alt="B2W Energia" 
                className="h-8 object-contain grayscale opacity-50 mb-4"
                referrerPolicy="no-referrer"
              />
              <p className="text-xs text-gray-400 text-left md:text-right">
                © 2026 B2W Energia. Todos os direitos reservados.<br />
                Este é um e-mail automático, por favor não responda.
              </p>
            </div>
          </div>
          
          <div className="text-[10px] text-gray-300 text-center border-t border-gray-200 pt-6">
            Você recebeu este e-mail porque é um cliente ativo da B2W Energia. Para gerenciar suas preferências de notificação, acesse as configurações da sua conta.
          </div>
        </footer>
      </div>
      
      {/* View Controls (Simulated Email Client) */}
      <div className="max-w-2xl mx-auto mt-8 flex justify-center gap-4">
        <div className="bg-white px-4 py-2 rounded-full shadow-sm border border-gray-200 flex items-center gap-2 text-xs text-gray-500">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          Visualização de E-mail Responsiva
        </div>
      </div>
    </div>
  );
}
