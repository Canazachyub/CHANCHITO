/** Registro modular de ECharts: solo lo que usan los gráficos del catálogo, para no cargar los ~1 MB completos. */
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, PolarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, PolarComponent, TooltipComponent, CanvasRenderer]);

export default echarts;
