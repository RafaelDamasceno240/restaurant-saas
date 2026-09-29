import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { InventoryItemsService } from './inventory-items.service';
import { StockMovementsService } from './stock-movements.service';
import { RecipesService } from './recipes.service';
import { InventoryCountsService } from './inventory-counts.service';
import { InventoryOverviewService } from './inventory-overview.service';
import {
  CreateInventoryItemDto,
  ItemBranchQueryDto,
  ListInventoryItemsQueryDto,
  UpdateInventoryItemDto,
} from './dto/inventory-items.dto';
import { CreateStockMovementDto, ListStockMovementsQueryDto } from './dto/stock-movements.dto';
import { PutRecipeDto, RecipeListQueryDto, RecipeQueryDto } from './dto/recipes.dto';
import { CreateInventoryCountDto } from './dto/inventory-counts.dto';
import { BranchQueryDto, SummaryQueryDto, UpdateInventorySettingsDto } from './dto/inventory-overview.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryOverviewController {
  constructor(private readonly overview: InventoryOverviewService) {}

  @Get('summary')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Indicadores do estoque da unidade no período' })
  summary(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: SummaryQueryDto) {
    return this.overview.summary(user, query);
  }

  @Get('alerts')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Sem estoque, estoque baixo, validade e produtos sem ficha técnica' })
  alerts(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: BranchQueryDto) {
    return this.overview.alerts(user, query);
  }

  @Get('balances')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Saldo, custo médio, valor e status dos insumos ativos da unidade' })
  balances(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: BranchQueryDto) {
    return this.overview.balances(user, query);
  }

  @Get('settings')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Configuração de estoque da unidade' })
  getSettings(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: BranchQueryDto) {
    return this.overview.getSettings(user, query);
  }

  @Patch('settings')
  @RequirePermissions('inventory.update')
  @ApiOperation({ summary: 'Permitir ou bloquear estoque negativo na unidade' })
  updateSettings(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: UpdateInventorySettingsDto) {
    return this.overview.updateSettings(user, dto);
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/items')
export class InventoryItemsController {
  constructor(private readonly items: InventoryItemsService) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Insumos do tenant, com saldo quando branchId é informado' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListInventoryItemsQueryDto) {
    return this.items.list(user, query);
  }

  @Post()
  @RequirePermissions('inventory.create')
  @ApiOperation({ summary: 'Cadastra um insumo' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateInventoryItemDto) {
    return this.items.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Detalhe de um insumo' })
  get(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ItemBranchQueryDto,
  ) {
    return this.items.get(user, id, query);
  }

  @Patch(':id')
  @RequirePermissions('inventory.update')
  @ApiOperation({ summary: 'Edita o insumo; a unidade de estoque é imutável' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.items.update(user, id, dto);
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/movements')
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Histórico de movimentações da unidade, com filtros' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListStockMovementsQueryDto) {
    return this.movements.list(user, query);
  }

  @Post()
  @RequirePermissions('inventory.movement.create')
  @ApiOperation({ summary: 'Entrada ou saída manual' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateStockMovementDto) {
    return this.movements.create(user, dto);
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Produtos com custo da ficha técnica, preço e margem' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: RecipeListQueryDto) {
    return this.recipes.list(user, query);
  }

  @Get(':productId')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Ficha técnica do produto com custo por insumo' })
  get(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: RecipeQueryDto,
  ) {
    return this.recipes.get(user, productId, query);
  }

  @Put(':productId')
  @RequirePermissions('inventory.recipe.manage')
  @ApiOperation({ summary: 'Substitui a ficha técnica do produto; lista vazia remove' })
  put(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: PutRecipeDto,
  ) {
    return this.recipes.put(user, productId, dto);
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/inventory-counts')
export class InventoryCountsController {
  constructor(private readonly counts: InventoryCountsService) {}

  @Post()
  @RequirePermissions('inventory.count')
  @ApiOperation({ summary: 'Registra uma contagem física e gera os ajustes das diferenças' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateInventoryCountDto) {
    return this.counts.create(user, dto);
  }
}
