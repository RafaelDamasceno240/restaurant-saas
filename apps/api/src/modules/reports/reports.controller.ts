import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import {
  CustomersReportQueryDto,
  InventoryReportQueryDto,
  PagedReportQueryDto,
  ProductsReportQueryDto,
  ReportPeriodQueryDto,
} from './dto/reports.dto';
import { ReportsService } from './reports.service';

// Read-only. tenantId always comes from the JWT (@CurrentUser); the branch filter is checked
// against what the caller may see. One permission for all of them: reports.read.
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Vendas do período: totais, por dia, por hora, por pagamento, origem e tipo' })
  sales(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ReportPeriodQueryDto) {
    return this.reports.sales(user, query);
  }

  @Get('products')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Produtos vendidos no período, por faturamento ou quantidade (paginado)' })
  products(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ProductsReportQueryDto) {
    return this.reports.products(user, query);
  }

  @Get('customers')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Clientes que mais compraram no período (paginado) e pedidos identificados x anônimos' })
  customers(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: CustomersReportQueryDto) {
    return this.reports.customers(user, query);
  }

  @Get('inventory')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Consumo, compras e perdas de estoque por insumo no período (paginado)' })
  inventory(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: InventoryReportQueryDto) {
    return this.reports.inventory(user, query);
  }

  @Get('delivery')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Entregas do período: situação, tempos, taxa e desempenho por entregador' })
  delivery(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ReportPeriodQueryDto) {
    return this.reports.delivery(user, query);
  }

  @Get('cash')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Sessões de caixa abertas no período, com totais e diferenças (paginado)' })
  cash(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: PagedReportQueryDto) {
    return this.reports.cash(user, query);
  }
}
