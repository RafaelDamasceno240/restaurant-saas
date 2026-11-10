import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { TabKitchenService } from './tab-kitchen.service';
import { AdvanceTabRoundDto } from './dto/advance-tab-round.dto';

// B9: the kitchen board's action on a table round. orders.update, the permission the kitchen
// already uses to move orders - the kitchen has no tabs.* permission and needs none: it never
// adds, cancels or bills anything.
@ApiTags('kitchen')
@ApiBearerAuth()
@Controller('kitchen/tab-rounds')
export class TabKitchenController {
  constructor(private readonly kitchen: TabKitchenService) {}

  @Patch(':id/status')
  @RequirePermissions('orders.update')
  @ApiOperation({ summary: 'Avança os itens de uma rodada de mesa (em preparo, pronto, entregue)' })
  advance(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string, @Body() dto: AdvanceTabRoundDto) {
    return this.kitchen.advanceRound(user, id, dto);
  }
}
